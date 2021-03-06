import * as vscode from "vscode";
import * as path from "path";
import * as nodeFs from "fs";

import DeepCode from "../../../interfaces/DeepCodeInterfaces";
import BundlesModule from "./BundlesModule";
import { deepCodeMessages } from "../../messages/deepCodeMessages";
import {
  DEFAULT_DEEPCODE_ENDPOINT,
  INSTALL_STATUS,
  STATUSFILE_NAME,
  DEEPCODE_NAME
} from "../../constants/general";
import { DEEPCODE_CLOUD_BACKEND } from "../../constants/settings";

export default class DeepCodeLib extends BundlesModule
  implements DeepCode.DeepCodeLibInterface {
  private watchersAreActivated: boolean = false;

  public activateWatchers(): void {
    this.filesWatcher.activate(this);
    this.workspacesWatcher.activate(this);
    this.editorsWatcher.activate(this);
    this.settingsWatcher.activate(this);
  }

  public async activateActions(): Promise<void> {
    const loginStatus = await this.login();
    if (loginStatus) {
      await this.activateExtensionAnalyzeActions();
      if (!this.watchersAreActivated) {
        this.activateWatchers();
        this.watchersAreActivated = true;
      }
    }
  }

  public async preActivateActions(): Promise<void> {
    let status = INSTALL_STATUS.installed;
    if (process.env.NODE_ENV === "production") {
      status = this.manageExtensionStatus();
    }
    if (status === INSTALL_STATUS.justInstalled) {
      return this.configureExtension();
    }
    const backendUrl = await vscode.workspace
      .getConfiguration()
      .get(DEEPCODE_CLOUD_BACKEND);

    if (backendUrl) {
      await this.config.changeDeepCodeUrl(backendUrl);
      await this.activateActions();
    } else {
      await this.store.actions.setBackendConfigStatus(false);
      await this.configureExtension();
    }
  }

  public manageExtensionStatus(): string {
    const extension = vscode.extensions.all.find(
      el => el.packageJSON.displayName === DEEPCODE_NAME
    );
    if (extension) {
      const statusFilePath = path.join(
        extension.extensionPath,
        `/${STATUSFILE_NAME}`
      );
      const extensionStatus = nodeFs.readFileSync(statusFilePath, "utf8");
      if (extensionStatus === INSTALL_STATUS.justInstalled) {
        this.store.cleanStore();
        nodeFs.writeFileSync(statusFilePath, INSTALL_STATUS.installed);
        return INSTALL_STATUS.justInstalled;
      }
    }
    return INSTALL_STATUS.installed;
  }
  public async configureExtension(): Promise<void> {
    const { msg, selfManagedBtn, cloudBtn } = deepCodeMessages.configureBackend;
    const configBackendReply = await vscode.window.showInformationMessage(
      msg,
      cloudBtn,
      selfManagedBtn
    );
    if (configBackendReply === selfManagedBtn) {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "deepcode"
      );
    }
    if (configBackendReply === cloudBtn) {
      await this.config.changeDeepCodeUrl(DEFAULT_DEEPCODE_ENDPOINT);
      await vscode.workspace
        .getConfiguration()
        .update(
          DEEPCODE_CLOUD_BACKEND,
          DEFAULT_DEEPCODE_ENDPOINT,
          vscode.ConfigurationTarget.Global
        );
      await this.store.actions.setBackendConfigStatus(true);
      await this.activateActions();
    }
  }

  public async activateExtensionAnalyzeActions(): Promise<void> {
    // check if user is loggedIn
    const isLoggedInUser = await this.store.selectors.getLoggedInStatus();
    if (!isLoggedInUser) {
      return;
    }

    const workspaceFolders: vscode.WorkspaceFolder[] | undefined =
      vscode.workspace.workspaceFolders;

    if (!workspaceFolders || !workspaceFolders.length) {
      return;
    } else {
      for await (const folder of workspaceFolders) {
        // check if upload confirmed for each of workspaces
        if (!this.checkUploadConfirm(folder.uri.fsPath)) {
          await this.showConfirmMsg(this, folder.uri.fsPath);
        }
      }
    }

    this.createWorkspacesList(workspaceFolders);
    if (this.workspacesPaths.length) {
      this.updateCurrentWorkspacePath(this.workspacesPaths[0]);
      await this.createFilesFilterList();
      await this.updateHashesBundles();
      for await (const path of this.workspacesPaths) {
        if (!this.checkUploadConfirm(path)) {
          continue;
        }
        await this.performBundlesActions(path);
      }
      await this.analyzer.reviewCode(this);
    }
  }
}
