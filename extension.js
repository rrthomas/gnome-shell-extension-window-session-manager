const St = imports.gi.St;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Clutter = imports.gi.Clutter;
//const Extension = ExtensionUtils.getCurrentExtension();
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Util = imports.misc.util;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const _ = imports.gettext.gettext;
const System = Main.panel.statusArea.aggregateMenu._system;
const GnomeSession = imports.misc.gnomeSession;
const LOGOUT_MODE_NORMAL = 0;
const Lib = Me.imports.lib;
const Gsettings = Lib.getSettings();

const HOME_PATH = GLib.get_home_dir();
const LWSM_PATH = HOME_PATH + '/.lwsm';
const LWSM_SESSION_PATH = LWSM_PATH + '/sessionData';
const LWSM_DEFAULT_CMD = '~/bin/lwsm';
const DEFAULT_INDICATOR_TEXT = '';
const APP_ID = 'lwsm@johannes.super-productivity.com';
const APP_DIR = HOME_PATH + '/.local/share/gnome-shell/extensions/lwsm@johannes.super-productivity.com/';

const SETUP_SH_PATH = APP_DIR + 'setup-lwsm.sh';

const WindowSessionIndicator = new Lang.Class({
  Name: 'WindowSessionIndicator',
  Extends: PanelMenu.Button,

  _init: function() {
    this.parent(0.0, 'Window Session Indicator', false);
    this._buildUi();
    this._refresh();
    this._checkLwsmExecutable(true);
  },

  _checkLwsmExecutable: function(isInitialCheck) {
    // check for executable
    const executablePath = this._getLwsmExecutablePath();
    if (!executablePath || !GLib.file_test(executablePath, GLib.FileTest.EXISTS)) {
      Main.notify('lwsm: ERROR: No lwsm executable', 'Please use the extension settings to point to a valid executable path.');
      if (!isInitialCheck) {
        that.statusLabel.set_text('ERR: No lwsm executable');
      }
      this._openSettings();
      return false;
    }

    return true;
  },

  _guessExecutableViaNodePath: function() {
    const nodePath = GLib.find_program_in_path('node');
    return nodePath && nodePath.substring(0, nodePath.length - 4) + 'lwsm'
  },

  _getLwsmExecutablePath: function() {
    let path;

    path = Gsettings.get_string('lwsmpath');
    path = path && path.trim();

    if (!path) {
      path = path || GLib.find_program_in_path('lwsm');
      path = path || this._guessExecutableViaNodePath();
      path = path || LWSM_DEFAULT_CMD;
    }

    return path;
  },

  _buildUi: function() {
    this.statusLabel = new St.Label({
      y_align: Clutter.ActorAlign.CENTER,
      text: DEFAULT_INDICATOR_TEXT
    });
    this.statusLabel.add_style_class_name('window-session-indicator-label');

    let topBox = new St.BoxLayout();
    //topBox.add_actor(button);
    topBox.add_actor(this.statusLabel);
    this.actor.add_actor(topBox);
    topBox.add_style_class_name('window-session-indicator');

    // Add logout button
    this._logoutButton = System._createActionButton('application-exit-symbolic', _("Log Out"));
    this._logoutButton.connect('button-press-event', Lang.bind(this, this._logout));
    if (System._actionsItem === undefined) { // GNOME >= 3.33
      System.buttonGroup.add(this._logoutButton, { expand: true, x_fill: false });
    } else if (System._session === undefined) { // GNOME >=3.26
      System._actionsItem.actor.add_child(this._logoutButton);
    } else {
      System._actionsItem.actor.add_child(this._logoutButton, { expand: true, x_fill: false });
    }
  },

  _createMenu: function() {
    this.lwsmSessionDir = Gio.file_new_for_path(LWSM_SESSION_PATH);

    // read files
    this.fileList = [];
    const enumeratedChildren = this.lwsmSessionDir.enumerate_children('*', 0, null);
    let fileInfo;
    while ((fileInfo = enumeratedChildren.next_file(null)) !== null) {
      if (!fileInfo.get_is_hidden() && !isDirectory(fileInfo)) {
        this.fileList.push(fileInfo);
      }
    }
    enumeratedChildren.close(null);

    // if nothing changed don't refresh menu
    if (this.fileListBefore && this.fileListBefore.length === this.fileList.length) {
      return;
    }

    // remove previous session section
    if (this._sessionSection) {
      this._sessionSection.removeAll();
    }

    // create new session section and menu
    this._sessionSection = new PopupMenu.PopupMenuSection();
    this.menu.addMenuItem(this._sessionSection);

    const that = this;
    this.fileList.forEach(Lang.bind(this, function(file) {
      that._sessionSection.addMenuItem(this._createMenuItem(file));
    }));
    that._sessionSection.addMenuItem(this._createNewSessionItem());
    this.fileListBefore = this.fileList;
  },

  _openSettings: function() {
    Util.spawn(['gnome-shell-extension-prefs', APP_ID]);
    return 0;
  },

  _createNewSessionItem: function() {
    const that = this;
    const item = new PopupMenu.PopupMenuItem('', {
      activate: false,
      reactive: true,
      can_focus: false,
    });
    const itemActor = item.actor;

    // add input
    let input = new St.Entry({
      name: 'NewItemInput',
      style_class: 'new-item-input',
      track_hover: true,
      reactive: true,
      can_focus: true,
    });
    itemActor.add(input, {
      expand: true
    });

    // add save button
    let _saveBtn = new St.Button({
      reactive: true,
      can_focus: true,
      x_fill: true,
      style_class: 'button-save',
    });
    _saveBtn.child = new St.Icon({
      icon_name: 'document-save-symbolic',
      style_class: 'popup-menu-icon-save',
    });
    _saveBtn.connect('clicked', Lang.bind(that, function() {
      that._saveSession(input.get_text(), function() {
        that._refresh();
      });
      return Clutter.EVENT_STOP;
    }));
    itemActor.add(_saveBtn);

    return item;
  }
  ,

  _createMenuItem: function(fileInfo) {
    const fileName = fileInfo.get_display_name().replace('.json', '');
    const item = new PopupMenu.PopupMenuItem('');
    const itemActor = item.actor;
    const that = this;

    // add main session label and icon
    itemActor.add(new St.Icon({
      icon_name: 'media-playback-start-symbolic',
      style_class: 'popup-menu-icon-play',
    }));
    itemActor.add(new St.Label({ text: fileName }), { expand: true });

    // add save button
    let _saveBtn = new St.Button({
      style_class: 'button-save',
      reactive: true,
      can_focus: true,
      x_fill: true,
    });
    _saveBtn.child = new St.Icon({
      icon_name: 'document-save-symbolic',
      style_class: 'popup-menu-icon-save',
    });
    _saveBtn.connect('clicked', Lang.bind(that, function() {
      that._saveSession(fileName);
      return Clutter.EVENT_STOP;
    }));
    itemActor.add(_saveBtn, {
      x_align: St.Align.END,
    });

    // add remove button
    let _removeBtn = new St.Button({
      style_class: 'button-delete',
      reactive: true,
      can_focus: true,
      x_fill: true,
    });
    _removeBtn.child = new St.Icon({
      icon_name: 'edit-delete-symbolic',
      style_class: 'popup-menu-icon-delete'
    });
    _removeBtn.connect('clicked', Lang.bind(that, function() {
      that._removeSession(fileName, function() {
        that._refresh();
      });
      return Clutter.EVENT_STOP;
    }));
    itemActor.add(_removeBtn, {
      x_align: St.Align.END,
    });

    item.connect('activate', Lang.bind(that, function() {
      that._restoreSession(fileName);
    }));
    return item;
  }
  ,

  _saveSession: function(sessionName, cb) {
    this._execLwsm('save', sessionName, cb);
  }
  ,

  _restoreSession: function(sessionName, cb) {
    this.lastSession = sessionName;
    this._execLwsm('restore', sessionName, cb);
  }
  ,

  _removeSession: function(sessionName, cb) {
    this._execLwsm('remove', sessionName, cb);
  }
  ,

  _execLwsm: function(action, sessionName, cb) {
    const that = this;

    // update lwsm command from settings each time it is executed
    const executable = this._getLwsmExecutablePath();

    if (!that._checkLwsmExecutable()) {
      return;
    }

    const msg = action + ' "' + sessionName + '"';
    this.statusLabel.set_text(msg);
    Main.notify('lwsm: ' + msg);

    let [success, pid] = GLib.spawn_async(
      null,
      [executable, action, sessionName],
      null,
      GLib.SpawnFlags.DO_NOT_REAP_CHILD,
      null
    );

    if (!success) {
      that.statusLabel.set_text('ERR');
      that.statusLabel.set_text(success + '#' + pid);
    } else {
      GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, function(pid, status) {
        GLib.spawn_close_pid(pid);
        if (status !== 0 && status !== '0') {
          that.statusLabel.set_text('ERR');
          global.log('lwsm', action, sessionName, 'UNKNOWN ERROR');
          Main.notify('lwsm: ' + action + ' ' + sessionName + ' UNKNOWN ERROR');
        } else {
          that.statusLabel.set_text(DEFAULT_INDICATOR_TEXT);
          if (cb) {
            cb();
          }
        }
      });
    }
  }
  ,

  _refresh: function() {
    this._createMenu();
    this._removeTimeout();
    this._timeout = Mainloop.timeout_add_seconds(10, Lang.bind(this, this._refresh));
    return true;
  }
  ,

  _removeTimeout: function() {
    if (this._timeout) {
      Mainloop.source_remove(this._timeout);
      this._timeout = null;
    }
  }
  ,
  stop: function() {
    if (this._timeout) {
      Mainloop.source_remove(this._timeout);
    }
    this._timeout = undefined;
    this.menu.removeAll();

    // Disable logout button
    if (System._actionsItem === undefined) { // GNOME >= 3.33
      System.buttonGroup.remove_child(this._logoutButton);
    } else {
      System._actionsItem.actor.remove_child(this._logoutButton);
    }
  },

  // Initiates a log out when the log out button is clicked
  _logout: function() {
    System.menu.itemActivated();
    Main.overview.hide();

    // Save default session
    this._saveSession('DEFAULT', function () {
      if (System._session === undefined) { // GNOME >=3.26
        var sessionManager = new GnomeSession.SessionManager();
        sessionManager.LogoutRemote(LOGOUT_MODE_NORMAL);
      } else {
        System._session.LogoutRemote(0);
      }
    });
  },

});

let wsMenu;

function init() {
}

function enable() {
  // try to create required directories if not existent already
  Util.spawn(['mkdir', LWSM_PATH]);
  Util.spawn(['mkdir', LWSM_SESSION_PATH]);

  wsMenu = new WindowSessionIndicator;
  Main.panel.addToStatusArea('ws-indicator', wsMenu);
}

function disable() {
  wsMenu.stop();
  wsMenu.destroy();
}

// HELPER
// ------
function isDirectory(file) {
  return Gio.FileType.DIRECTORY === file.get_file_type();
}