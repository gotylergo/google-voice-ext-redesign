// Copyright 2009 Google Inc. All Rights Reserved.

/**
 * @fileoverview Runs the Chrome extension.
 * Contains code to run both the background and the popup.
 *
 * TODO(brianp): Consider breaking out background and popup code into
 * separate files. Haven't yet because it makes local dev easier when the
 * same filename is used for production.
 *
 * @author brianp@google.com (Brian Peterson)
 */

goog.provide('gc');
goog.provide('gc.Background');
goog.provide('gc.CallWidget');
goog.provide('gc.LoadingAnimation');
goog.provide('gc.Popup');

goog.require('goog.Timer');
goog.require('goog.Uri.QueryData');
goog.require('goog.array');
goog.require('goog.dom');
goog.require('goog.dom.classes');
goog.require('goog.events');
goog.require('goog.fx.dom');
goog.require('goog.net.XhrIo');
goog.require('goog.object');
goog.require('goog.positioning');
goog.require('goog.string');
goog.require('goog.style');
goog.require('goog.ui.Component');
goog.require('goog.ui.CustomButton');
goog.require('goog.ui.LabelInput');
goog.require('goog.ui.Popup');
goog.require('goog.ui.PopupBase');
goog.require('goog.ui.ToggleButton');
goog.require('goog.ui.style.app.ButtonRenderer');

var $dom = goog.dom.$dom;
var $$ = goog.dom.getElementsByTagNameAndClass;


/**
 * Color of square badge on extension icon.
 * @type {Array}
 */
gc.BADGE_COLOR = [0, 69, 208, 255];

/**
 * @desc Connect button caption.
 */
gc.MSG_CONNECT = goog.getMsg('Connect');

/**
 * @desc Button message when connecting call.
 */
gc.MSG_CONNECTING = goog.getMsg('Connecting...');

/**
 * URI for getting all the data for the inbox.
 * @type {string}
 */
gc.INBOX_URI = '/request/messages/';

/**
 * @desc Short version of invalid phone number.
 */
gc.MSG_INVALID_NUMBER_SHORT = goog.getMsg('Invalid number.');

/**
 * @desc Quick call/sms error message.
 */
gc.MSG_QUICK_ACTION_ERROR = goog.getMsg('Please try again.');

/**
 * @desc Status message when quick call is initiated.
 */
gc.MSG_CALLING_YOU = goog.getMsg('Calling you...');

/**
 * Unique rnr session id needed to make post requests.
 * @type {string}
 */
var rnrSessionId;

/**
 * Decorate the given div element as a Closure CustomButton.
 *
 * @param {Element} divElement The div element to decorate.
 * @param {goog.ui.ControlRenderer=} opt_renderer Optional renderer to use.
 * @return {goog.ui.CustomButton} The custom button object.
 */
gc.decorateButton = function(divElement, opt_renderer) {
  var button = new goog.ui.CustomButton(null,
      opt_renderer || goog.ui.style.app.ButtonRenderer.getInstance());
  button.decorate(divElement);
  return button;
};

/**
 * Constructs a url given the URI.
 * Puts the base url together with account selection path and the request URI.
 *
 * @param {boolean} is_api True if getting an URL for API calls.
 * @param {string} uri The URI of the request.
 * @param {string=} opt_addParam True to add account parameter to URL.
 *     ex: ?b=0.
 * @param {boolean=} opt_excludeBaseUrl True to exclude the base URL in the
 *     return url.
 * @return {string} The full URL of the desired request.
 */
gc.getUrl = function(is_api, uri, opt_addParam, opt_excludeBaseUrl) {
  var account = localStorage['account'] || '0';
  var baseUrl = is_api ? gc.BASE_URL_ : gc.MOYA_URL;
  var accountSelector = is_api ? 'b' : 'u';
  var url = accountSelector + '/' + account + uri;
  var fullUrl = baseUrl + '/' + url;

  if (opt_excludeBaseUrl) {
    return url;
  }

  if (opt_addParam) {
    fullUrl += '?' + accountSelector + '=' + account;
  }
  return fullUrl;
};

/**
 * Show the user as being logged out.
 */
gc.showLoggedOut = function() {
  localStorage['loggedOut'] = '1';
  chrome.browserAction.setIcon({
    'path' : {
      '19': 'bubble-19-lo.png',
      '38': 'bubble-38-lo.png'
    }});
  chrome.browserAction.setBadgeBackgroundColor({'color': [190, 190, 190, 230]});
  chrome.browserAction.setBadgeText({'text': '?'});
};

/**
 * Go to the Google Voice inbox.
 * If a tab is already open with Google Voice, then reload and go to that tab.
 *
 * @param {?string=} opt_uri Additional URI to append to the url.
 */
gc.goToInbox = function(opt_uri) {
  var uri = !!opt_uri ? opt_uri : '';

  chrome.tabs.getAllInWindow(null, function(tabs) {
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      if (goog.string.contains(tab['url'], gc.MOYA_URL)) {
        chrome.tabs.update(tab['id'], {
          'url': gc.getUrl(false, uri),
          'selected': true
        });
        return;
      }
    }

    chrome.tabs.create({'url': gc.getUrl(false, uri)});
  });
};

/**
 * Load general user data like contacts and subscriber info.
 *
 * @param {Function=} opt_callback Method to call after load.
 */
gc.loadUserData = function(opt_callback) {
  if (localStorage['loggedOut']) {
    gc.showLoggedOut();
  } else {
    // Load data if local storage doesn't exist or last update was more than
    // CACHE_TIME ago.
    goog.net.XhrIo.send(gc.getUrl(true, gc.Background.DATA_URL_, true),
        goog.partial(gc.handleUserDataResponse_, opt_callback), 'GET');
  }
};

/**
 * Response from user data request.
 *
 * @param {Function} callback Method to call after load.
 * @param {goog.events.Event} e The xhr event.
 * @private
 */
gc.handleUserDataResponse_ = function(callback, e) {
  if (e.target.getResponseText().length) {
    localStorage['loggedOut'] = '';

    var json = e.target.getResponseJson();

    // Only cache data we care about for the extension.
    var data = {
      'number': json['number'],
      'type': json['type'],
      'phones': json['phones'],
      'contactPhones': json['contactPhones'],
      'r': json['r']
    };

    // Local storage doesn't accept objects so store as text.
    localStorage['data'] = JSON.stringify(data);
    localStorage['timestamp'] = new Date();

    if (callback) {
      callback();
    }
  } else {
    gc.showLoggedOut();
  }
};

/**
 * Base url to use for requests.
 * @private {string}
 */
gc.BASE_URL_ = 'https://www.google.com/voice';

/**
 * Url of the Moya Google Voice website.
 * @type {string}
 */
gc.MOYA_URL = 'https://voice.google.com';

/**
 * URI for making a call.
 * @private {string}
 */
gc.CALL_URI_ = '/call/connect/';

/**
 * URI for canceling a call.
 * @private {string}
 */
gc.CANCEL_URI_ = '/call/cancel/';

/**
 * Cancel the phone call.
 * Sends a request to cancel the phone call.
 * TODO(brianp): Add callback to handle failed request.
 *
 * @param {string} number The phone number that was called.
 * @param {string} phone The forwarding number used.
 * @param {string} sessionId The user's session id.
 */
gc.cancelCall = function(number, phone, sessionId) {
  var queryData = new goog.Uri.QueryData();
  queryData.set('outgoingNumber', number);
  queryData.set('forwardingNumber', phone);
  queryData.set('cancelType', 'C2C');
  queryData.set('_rnr_se', sessionId);

  goog.net.XhrIo.send(gc.getUrl(true, gc.CANCEL_URI_), null, 'POST',
      queryData.toString());
};

/**
 * Parse the user data from local storage and return.
 *
 * @return {Object} Object of user data.
 */
gc.parseData = function() {
  return JSON.parse(localStorage['data']);
};

/**
 * Main class that operates the voice background extension.
 *
 * TODO(brianp): Add jsdoc for member vars.
 *
 * @constructor
 */
gc.Background = function() {
  this.rotation_ = 0;
  // unreadCount_ is set to -2 to indicate we don't have a value at all.
  // In the past we've stored a -1 which has a different meaning. To be
  // honest, I'm not sure if anyone actually knows how this thing works
  // anymore.
  this.unreadCount_ = -2;
};

/**
 * Number of request failures in a row. Used to adjust the timeout between
 * request tries.
 * @type {number}
 */
gc.Background.requestFailures = 0;

/**
 * Url of the Google Voice website. This is used to detect if the user
 * has loaded the voice site in the browser. Then triggers update of data.
 * @type {string}
 */
gc.Background.VOICE_URL = 'https://www.google.com/voice';

/**
 * URI for unread request. This is the main request and it called the most
 * frequently.
 *
 * TODO(robertdong): change back to clients4 when this is allowed.
 *
 * @type {string}
 */
gc.Background.API_URL = '/request/unread/';

/**
 * URI for user data request.
 * @type {string}
 * @private
 */
gc.Background.DATA_URL_ = '/request/user/';

/**
 * Number of frames for the spinning animation.
 * @type {number}
 */
gc.Background.ANIMATION_FRAMES = 36;

/**
 * How fast should the animation move.
 * @type {number}
 */
gc.Background.ANIMATION_SPEED = 20;

/**
 * How often to poll for unread messages, in seconds.
 * @type {number}
 */
gc.Background.POLL_INTERVAL_MIN = 60;  // 1 minute.

/**
 * Upper bound for poll interval. Reaches this when a certain amount of
 * requests fail in a row. In seconds.
 * @type {number}
 */
gc.Background.POLL_INTERVAL_MAX = 3600;  // 1 hour.

/**
 * General request timeout for checking for new messages.
 * @type {number}
 */
gc.Background.REQUEST_TIMEOUT = 1000 * 5;  // 5 seconds.

/**
 * Animation rotation value.
 * @type {number}
 */
gc.Background.ROTATION = 0;

/**
 * Initialize/Start the background process.
 */
gc.Background.prototype.init = function() {
  this.canvas_ = document.getElementById('canvas');
  this.loggedInImage_ = document.getElementById('gc-logged-in');
  this.canvasContext_ = this.canvas_.getContext('2d');
  this.audio_ = document.getElementById('gc-bell');
  chrome.browserAction.setIcon({
    'path' : {
      '19': 'bubble-19.png',
      '38': 'bubble-38.png'
    }});

  this.updateUnreadUI_();
  this.requestUserData_();

  // Periodically update the unread UI.
  this.initializeUnreadCountRepeatingAlarm_();

  // Listen for requests from the content script.
  chrome.extension.onMessage.addListener(
      goog.bind(this.handleContentScriptRequest_, this));

  // Called when the user clicks on the browser action.
  chrome.browserAction.onClicked.addListener(function(tab) {
    gc.goToInbox();
  });
};

/**
 * Handle any content script requests.
 * Must be done in the background script because content scripts are limited
 * to what they can do themselves.
 *
 * @param {Object} request The request object that comes from the conten script.
 * @param {Object} sender Represents the tab/window that sent the request.
 * @param {Function} sendResponse Callback method to call to send response
 *     back to the sender.
 * @return {boolean} True if handled.
 * @private
 */
gc.Background.prototype.handleContentScriptRequest_ = function(request, sender,
    sendResponse) {
  switch (request['action']) {
    case 'links':
      var linksOff = localStorage['linksOff'] || '';
      var selectOff = localStorage['selectOff'] || '';
      var loggedOut = localStorage['loggedOut'] || '';

      // If is a client only account, tell content script to treat as
      // logged off since there is no calling for client only accounts.
      if (localStorage['isClient']) {
        loggedOut = true;
      }

      chrome.tabs.getSelected(null, function(tab) {
        // Don't convert numbers on voice site or gmail.
        if (tab.url.indexOf(gc.Background.VOICE_URL) == 0) {
          linksOff = '1';
          selectOff = '1';
        }

        sendResponse({'linksOff': linksOff,
                      'selectOff': selectOff,
                      'loggedOut': loggedOut});
      });

      break;
    case 'phones':
      if (localStorage['loggedOut']) {
        sendResponse({'loggedOut': '1'});
      } else if (localStorage['data']) {
        this.sendPhoneDataResponse_(sendResponse);
      } else {
        // User data doesn't exist so try to get it again.
        gc.loadUserData(goog.bind(this.sendPhoneDataResponse_, this,
            sendResponse));
      }
      break;
    case 'cancel':
      var data = gc.parseData();
      gc.cancelCall(request['number'], request['phone'], data['r']);
      break;
    case 'closeWidget':
    case 'resizeWidget':
      chrome.tabs.getSelected(null, function(tab) {
        chrome.tabs.sendMessage(tab['id'], {'action': request['action']});
      });
      break;
    default:
      sendResponse({}); // snub them.
  }
  return true;
};

/**
 * Send back the phone data from a content script request.
 *
 * @param {Function} sendResponse Callback method to call to send response
 *     back to the sender.
 * @private
 */
gc.Background.prototype.sendPhoneDataResponse_ = function(sendResponse) {
  var data = gc.parseData();
  var phones = data['phones'];

  // Remove GTalk from click to call options
  for (var id in phones) {
    if (phones[id].type === 9) { // Forwarding.Type.GOOGLE_TALK
      phones[id] = null;
    }
  }

  sendResponse({
    'phones': phones,
    'savedPhone': localStorage['phone'],
    'did': data['number'],
    'r': data['r']
  });
};

/**
 * Starts the repeating alarm for the API request. This updates the unread
 * item count for the inbox after a fixed periodic interval.
 * @private
 */
gc.Background.prototype.initializeUnreadCountRepeatingAlarm_ = function() {
  // Only do data requests if the account isn't a client only account.
  if (!localStorage['isClient']) {
    var period = gc.Background.POLL_INTERVAL_MIN;
    if (localStorage['pollInterval']) {
      period = localStorage['pollInterval'];
    }

    period = period * Math.pow(2, gc.Background.requestFailures);
    period = Math.min(gc.Background.POLL_INTERVAL_MAX, period);
    period = Math.max(gc.Background.POLL_INTERVAL_MIN, period);
    period = Math.round(period);
    var periodMins = Math.round(period / 60);
    // chrome.alarms have a one minute minimum delay.
    periodMins = Math.min(1, periodMins);
    chrome.alarms.create('gvinboxpoll', {periodInMinutes: periodMins});
    chrome.alarms.onAlarm.addListener(goog.bind(this.alarmTriggered, this));
  }
};

/**
 * Function to handle triggered alarm
 * @param {!chrome.alarms.Alarm} alarm Triggered alarm.
 */
gc.Background.prototype.alarmTriggered = function(alarm) {
  this.updateUnreadUI_();
};

/**
 * Update unread count UI (or render logged out UI if user is logged out.)
 * @private
 */
gc.Background.prototype.updateUnreadUI_ = function() {
  var self = this;
  this.getInboxCount(
    function(count) {
      self.updateUnreadCount(count += '');
    },
    function() {
      self.handleLoggedOut();
    }
  );
};

/**
 * Make the AJAX request to the API url to get the inbox unread count.
 *
 * TODO(brianp): Move all XHR requests to using Closure.
 *
 * @param {Function} onSuccess Function callback on successful request.
 * @param {Function=} opt_onError Function callback for error.
 */
gc.Background.prototype.getInboxCount = function(onSuccess, opt_onError) {
  goog.net.XhrIo.send(gc.getUrl(true, gc.Background.API_URL, true),
      goog.bind(this.handleInboxCountResponse_, this, onSuccess,
          opt_onError), 'GET', null, null, gc.Background.REQUEST_TIMEOUT);
};

/**
 * Callback from the getInboxCount request.
 *
 * @param {Function} successCallback Callback function to call on successful
 *     request.
 * @param {Function} errorCallback Callback function to call on error with
 *     request.
 * @param {goog.events.Event} e The xhr event.
 * @private
 */
gc.Background.prototype.handleInboxCountResponse_ = function(successCallback,
    errorCallback, e) {
  if (e.target.isSuccess()) {
    var data;
    try {
      data = e.target.getResponseJson();
    } catch (err) {
      this.handleInboxCountError_(errorCallback);
      return;
    }

    var count;
    if (data['unreadCounts']) {
      if ('inbox' in data['unreadCounts']) {
        // If session id has changed, then user has logged in with
        // a different account so reset the data.
        if (rnrSessionId && rnrSessionId != data['r']) {
          // User changed. Reload the user data.
          gc.loadUserData();
        }
        rnrSessionId = data['r'];
        count = data['unreadCounts']['inbox'];
        localStorage['isClient'] = '';
      } else {
        // If 'inbox' label not in 'unreadCounts' then it is a client only
        // account.
        count = 0;
        localStorage['isClient'] = true;
        localStorage['data'] = '';
      }

      if (data['pollInterval']) {
        localStorage['pollInterval'] = data['pollInterval'];
      }
    } else {
      this.handleInboxCountError_(errorCallback);
      return;
    }

    gc.Background.requestFailures = 0;
    localStorage['loggedOut'] = '';
    if (successCallback) {
      successCallback(count);
    }
  } else {
    this.handleInboxCountError_(errorCallback);
  }
};

/**
 * Error callback from a unsuccessful inbox count request.
 *
 * @param {Function} errorCallback The method to call when the request fails.
 * @private
 */
gc.Background.prototype.handleInboxCountError_ = function(errorCallback) {
  gc.Background.requestFailures++;

  if (errorCallback) {
    errorCallback();
  }
};

/**
 * Load and show a notification with the newest inbox sms, voicemail or missed
 * call.
 *
 * @private
 */
gc.Background.prototype.throwNotification_ = function() {
  goog.Timer.callOnce(goog.bind(function() {
      goog.net.XhrIo.send(gc.getUrl(true, gc.INBOX_URI),
        goog.bind(this.handleNotification_, this), 'GET');
      }, this), 1);
};


/**
 * Handle response from inbox load.
 *
 * @param {goog.events.Event} e the Xhr event.
 * @private
 */
gc.Background.prototype.handleNotification_ = function(e) {
  if (e.target.getResponseText().length) {
    var inboxData = e.target.getResponseJson();
    var messageContacts = inboxData['contacts'];
    var newestMessage = inboxData['messageList'][0];
    var numChildren = newestMessage['children'].length;
    var message = newestMessage['children'][numChildren - 1];
    var contact = messageContacts['contactPhoneMap'][message['phoneNumber']];
    var fromText = contact ?
        contact['name'] || contact['displayNumber'] : 'Unknown';
    var prependText = '';
    var messageText = '';
    switch (newestMessage['type']) {
      case 10:
        prependText = 'SMS: ';
        messageText = message['message'];
        break;
      case 2:
        prependText = 'Voicemail: ';
        messageText = message['message'];
        break;
      case 0:
        messageText = 'New Missed Call';
        break;
    }
    var notification = window.webkitNotifications.createNotification(
        'voice-48.png',
        prependText + fromText, messageText);
    notification.show();
  }
};

/**
 * Update the display of the unread count.
 *
 * @param {string} count Number of unread messages as a string.
 */
gc.Background.prototype.updateUnreadCount = function(count) {
  var nothingExciting = (count == localStorage['unreadCount']);

  var displayCount = count;
  localStorage['unreadCount'] = count;

  if (nothingExciting) {
    this.unreadCount_ = count;
    this.animateFlip(0);
    return;
  }

  // If number of unread messages is greater than 99, just show 99+.
  if (parseInt(count, 10) > 99) {
    displayCount = '99+';
  }

  var rotations = 1;

  if (this.unreadCount_ >= 0 &&
      this.unreadCount_ < parseInt(count, 10)) {
    if (!localStorage['alertOff']) {
      this.audio_.load();
      this.audio_.play();
    }
    if (!localStorage['notifyOff']) {
      this.throwNotification_();
    }
  }

  if (this.unreadCount_ != displayCount) {
    this.unreadCount_ = displayCount;
    this.animateFlip(rotations);
  }
};

/**
 * Ease animation function.
 *
 * @param {number} x The ease adjustment amount.
 * @return {number} Ease amount.
 */
gc.Background.prototype.ease = function(x) {
  return (1 - Math.sin(Math.PI / 2 + x * Math.PI)) / 2;
};

/**
 * Animate a flip of the canvas image.
 * @param {number} rotations Number of rotations for the flip.
 */
gc.Background.prototype.animateFlip = function(rotations) {
  this.rotation_ += 1 / gc.Background.ANIMATION_FRAMES;
  this.drawIconAtRotation();

  if (rotations > 1) {
    chrome.browserAction.setBadgeText({
      'text': this.unreadCount_ != '0' ? this.unreadCount_ : ''
    });
  }

  if (this.rotation_ <= rotations) {
    var self = this;
    setTimeout(function() {
      self.animateFlip(rotations);
    }, gc.Background.ANIMATION_SPEED);
  } else {
    this.rotation_ = 0;
    this.drawIconAtRotation();
    chrome.browserAction.setBadgeText({
      'text': this.unreadCount_ != '0' ? this.unreadCount_ : ''
    });
    chrome.browserAction.setBadgeBackgroundColor({'color': gc.BADGE_COLOR});
  }
};

/**
 * Show the logged out display. Changes the extension image to a grayed out
 * version and adds a question mark.
 */
gc.Background.prototype.handleLoggedOut = function() {
  this.unreadCount_ = -1;
  gc.showLoggedOut();
};

/**
 * Draw the icon for each rotation position.
 */
gc.Background.prototype.drawIconAtRotation = function() {
  this.canvasContext_.save();
  this.canvasContext_.clearRect(0, 0, this.canvas_.width, this.canvas_.height);
  this.canvasContext_.translate(
      Math.ceil(this.canvas_.width / 2),
      Math.ceil(this.canvas_.height / 2));
  this.canvasContext_.rotate(2 * Math.PI * this.ease(this.rotation_));
  this.canvasContext_.drawImage(this.loggedInImage_,
      -Math.ceil(this.canvas_.width / 2),
      -Math.ceil(this.canvas_.height / 2));
  this.canvasContext_.restore();

  chrome.browserAction.setIcon({
    'imageData': this.canvasContext_.getImageData(0, 0,
        this.canvas_.width, this.canvas_.height)
  });
};

/**
 * Start request for general user data, and set a timer to request again
 * after certain time.
 *
 * @private
 */
gc.Background.prototype.requestUserData_ = function() {
  gc.loadUserData();
  window.setTimeout(goog.bind(this.requestUserData_, this), 1000 * 60 * 30);
};


/**
 * Class that operates the popup window of the extension.
 * @constructor
 */
gc.Popup = function() {
  this.eventHandler_ = new goog.events.EventHandler(this);

  // Check settings to see if we go straight to the website.
  this.defaultBvr_ = localStorage['default'] || '2';
  if (this.defaultBvr_ == '0') {
    this.showLoading_(true);
    this.goToVoice_();
    return;
  } else if (localStorage['loggedOut']) {
    gc.showLoggedOut();
    this.showLoading_(true);
    this.goToVoice_();
    return;
  } else if (localStorage['isClient']) {
    this.showClientOnlyPopup_();
    return;
  }

  this.logo_ = goog.dom.getElement('gc-logo');

  this.callContent_ = goog.dom.getElement('gc-quickcall');
  this.smsContent_ = goog.dom.getElement('gc-quicksms');
  this.inboxContent_ = goog.dom.getElement('gc-inbox');

  this.retryAction_ = true;

  // Tab toggle buttons.
  this.showCall_ = new goog.ui.ToggleButton(null,
      goog.ui.style.app.ButtonRenderer.getInstance());
  this.showCall_.decorate(goog.dom.getElement('gc-tab-call'));
  this.showSms_ = new goog.ui.ToggleButton(null,
      goog.ui.style.app.ButtonRenderer.getInstance());
  this.showSms_.decorate(goog.dom.getElement('gc-tab-sms'));
  this.showInbox_ = new goog.ui.ToggleButton(null,
      goog.ui.style.app.ButtonRenderer.getInstance());
  this.showInbox_.decorate(goog.dom.getElement('gc-tab-inbox'));

  this.eventHandler_.listen(this.logo_,
      goog.events.EventType.CLICK, this.goToVoice_);
  this.eventHandler_.listen(goog.dom.getElement('gc-goto-inbox'),
      goog.events.EventType.CLICK, this.goToVoice_);
  this.eventHandler_.listen(goog.dom.getElement('gc-popout'),
      goog.events.EventType.CLICK, this.popoutExtension_);
  this.eventHandler_.listen(this.showCall_,
      goog.ui.Component.EventType.ACTION,
      goog.bind(this.switchTab_, this, 'call', null, false));
  this.eventHandler_.listen(this.showSms_,
      goog.ui.Component.EventType.ACTION,
      goog.bind(this.switchTab_, this, 'sms', null, false));
  this.eventHandler_.listen(this.showInbox_,
      goog.ui.Component.EventType.ACTION,
      goog.bind(this.switchTab_, this, 'inbox', null, false));

  // Call setup.
  this.phoneNumberInput_ = new goog.ui.LabelInput('');
  this.phoneNumberInput_.decorate(goog.dom.getElement('gc-quickcall-ac'));

  this.connect_ = gc.decorateButton(
      goog.dom.getElement('gc-quickcall-connect'));
  this.cancel_ = gc.decorateButton(
      goog.dom.getElement('gc-quickcall-cancel'));

  this.callMsg_ = gc.Notification.getInstance('gc-quickcall-msg');

  this.isCallDisabled_ = false;
  this.retryCall_ = true;

  this.eventHandler_.listen(this.connect_,
      goog.ui.Component.EventType.ACTION, this.handleCallAction_);
  this.eventHandler_.listen(this.cancel_,
      goog.ui.Component.EventType.ACTION, this.handleCallAction_);

  // SMS setup.
  this.send_ = gc.decorateButton(
      goog.dom.getElement('gc-quicksms-send'));
  this.smsTo_ = goog.dom.getElement('gc-quicksms-number');
  this.smsNumberInput_ = new goog.ui.LabelInput('');
  this.smsNumberInput_.decorate(this.smsTo_);
  this.message_ = goog.dom.getElement('gc-quicksms-text');
  this.counterArea_ = goog.dom.getElement('gc-quicksms-cnt');

  this.smsMsg_ = gc.Notification.getInstance('gc-quicksms-msg');
  this.retrySms_ = true;

  this.eventHandler_.listen(this.send_,
      goog.ui.Component.EventType.ACTION, this.sendSms_);
  this.eventHandler_.listen(this.smsTo_,
      goog.events.EventType.CHANGE,
      this.handleSmsToChange_);
  this.eventHandler_.listen(this.message_,
      goog.events.EventType.KEYPRESS,
      gc.Popup.limitTextInput);
  this.eventHandler_.listen(this.message_,
      goog.events.EventType.KEYUP,
      goog.partial(gc.Popup.adjustCounter, this.counterArea_));

  this.statusMsg_ = gc.Notification.getInstance('gc-status');

  var tab;
  if (this.defaultBvr_ != '0') {
    if (this.defaultBvr_ == '1') {
      // Go to last viewed tab.
      tab = localStorage['tab'] || 'call';
    } else if (this.defaultBvr_ == '2') {
      // Go to inbox if new messages, else go to last viewed tab.
      var unreadCount = localStorage['unreadCount'] || '0';
      if (parseInt(unreadCount, 10) > 0) {
        tab = 'inbox';
      } else {
        tab = localStorage['tab'] || 'call';
      }
    } else {
      tab = this.defaultBvr_;
    }

    this.switchTab_(tab, null, true);
  }

  this.init_();
};

/**
 * URI for sending SMS.
 * @type {string}
 * @private
 */
gc.Popup.SMS_URI_ = '/sms/send/';

/**
 * Mark as read URI.
 * @type {string}
 * @private
 */
gc.Popup.MARK_URI_ = '/inbox/mark/';

/**
 * URI for archiving messages.
 * @type {string}
 * @private
 */
gc.Popup.ARCHIVE_URI_ = '/inbox/archiveMessages/';

/**
 * URI for deleting messages.
 * @type {string}
 * @private
 */
gc.Popup.DELETE_URI_ = '/inbox/deleteMessages/';

/**
 * URI for getting the voicemail audio.
 * @type {string}
 * @private
 */
gc.Popup.AUDIO_URI_ = '/media/send_voicemail/';

/**
 * Link to upgrade for client only account.
 * @type {string}
 * @private
 */
gc.Popup.UPGRADE_URL_ = 'https://voice.google.com';

/**
 * Length of time (in ms) to display 'Calling' message.
 * @type {number}
 */
gc.Popup.MESSAGE_DELAY = 12000;

/**
 * Length of time (in ms) to display 'Cancel' button before
 * we reset to original state.
 * @type {number}
 */
gc.Popup.RESET_DELAY = 35000;

/**
 * Length of a single SMS message.
 * @type {number}
 */
gc.Popup.SMS_LENGTH = 160;

/**
 * Max characters allowed to send at once.
 * @type {number}
 */
gc.Popup.SMS_MAX = 440;

/**
 * Start the initialization of the popup.
 *
 * @private
 */
gc.Popup.prototype.init_ = function() {
  var now = new Date();

  if (!localStorage['data']) {
    gc.loadUserData(goog.bind(this.initializeData_, this));
  } else {
    this.initializeData_();
  }
  localStorage['lastPopup'] = now;
};

/**
 * Go to the Google Voice website.
 *
 * @private
 */
gc.Popup.prototype.goToVoice_ = function() {
  gc.goToInbox();
  // Must add delay on window close for the go to inbox to catch.
  goog.Timer.callOnce(window.close, 800);
};

/**
 * Display the pop out version of the extension. Loads a popup window.
 *
 * @private
 */
gc.Popup.prototype.popoutExtension_ = function() {
  var vp = window.open(chrome.extension.getURL('popup.html'),
      'gc-popout-window',
      'width=348,height=654');

  this.eventHandler_.listenOnce(vp, goog.events.EventType.LOAD,
      function() {
        goog.dom.classes.set(vp.window.document.body, 'gc-popout');
      });
};

/**
 * Show/Hide the loading display.
 * Used mainly when the user is being redirected to the website,
 * either because they are logged out or they chose the option to always
 * go straight to the website.
 *
 * @param {boolean} visible True to show loading, false to hide.
 * @private
 */
gc.Popup.prototype.showLoading_ = function(visible) {
  var loading = goog.dom.getElement('gc-loading-site');
  var popupContents = goog.dom.getElement('gc-popup-c');

  goog.style.setElementShown(loading, visible);
  goog.style.setElementShown(popupContents, !visible);
};

/**
 * Displays contents for a client only account.
 * Currently just displays message that extension doesn't work with client
 * only accounts and has a link upgrade the account.
 *
 * @private
 */
gc.Popup.prototype.showClientOnlyPopup_ = function() {
  var clientContents = goog.dom.getElement('gc-client');
  var popupContents = goog.dom.getElement('gc-popup-c');

  // Initialize link to upgrade url.
  this.eventHandler_.listen(goog.dom.getElement('gc-client-link'),
      goog.events.EventType.CLICK,
      function(e) {
        chrome.tabs.create({'url': gc.Popup.UPGRADE_URL_});
      });

  goog.style.setElementShown(clientContents, true);
  goog.style.setElementShown(popupContents, false);
};

/**
 * Switch to one of the tabs in the popup.
 * Call, SMS, or Inbox.
 *
 * @param {string} tab The tab id to switch to.
 * @param {string=} opt_value Optional value to use when switching.
 * @param {boolean=} opt_isPopupDisplay True if it's triggered on popup display.
 * @param {goog.events.Event=} opt_e Event from the tab switch.
 * @private
 */
gc.Popup.prototype.switchTab_ = function(tab, opt_value, opt_isPopupDisplay,
    opt_e) {
  var timeout = opt_isPopupDisplay ? 100 : 0;

  switch (tab) {
    case 'call':
      this.showCall_.setChecked(true);
      this.showSms_.setChecked(false);
      this.showInbox_.setChecked(false);

      // Temporary fix for chrome on mac display issues.
      goog.Timer.callOnce(goog.bind(function() {
        goog.style.setElementShown(this.callContent_, true);

        if (opt_value) {
          this.phoneNumberInput_.setValue(opt_value);
          this.connect_.setFocused(true);
          this.connect_.getElement().focus();
        } else {
          this.phoneNumberInput_.setValue(this.smsNumberInput_.getValue());
          this.phoneNumberInput_.focusAndSelect();
        }
      }, this), timeout);
      goog.style.setElementShown(this.smsContent_, false);
      goog.style.setElementShown(this.inboxContent_, false);

      break;
    case 'sms':
      this.showCall_.setChecked(false);
      this.showSms_.setChecked(true);
      this.showInbox_.setChecked(false);
      goog.style.setElementShown(this.callContent_, false);

      // Temporary fix for chrome on mac display issues.
      goog.Timer.callOnce(goog.bind(function() {
        goog.style.setElementShown(this.smsContent_, true);

        if (localStorage['smsText']) {
          this.message_.value = localStorage['smsText'];
        }

        if (opt_value) {
          this.smsNumberInput_.setValue(opt_value);
          this.message_.focus();
        } else if (localStorage['smsTo']) {
          this.smsNumberInput_.setValue(localStorage['smsTo']);
          this.message_.focus();
        } else {
          this.smsNumberInput_.setValue(this.phoneNumberInput_.getValue());
          this.smsNumberInput_.focusAndSelect();
        }
      }, this), timeout);
      goog.style.setElementShown(this.inboxContent_, false);

      break;
    case 'inbox':
      this.showCall_.setChecked(false);
      this.showSms_.setChecked(false);
      this.showInbox_.setChecked(true);
      goog.style.setElementShown(this.callContent_, false);
      goog.style.setElementShown(this.smsContent_, false);
      goog.style.setElementShown(this.inboxContent_, true);
      this.loadInbox_();
      break;
  }

  localStorage['tab'] = tab;

  if (opt_e) {
    opt_e.stopPropagation();
  }
};

/**
 * Initialize all of the data from local storage.
 *
 * @private
 */
gc.Popup.prototype.initializeData_ = function() {
  // Parse string to object from local storage.
  var data = gc.parseData();

  this.did_ = data['number'];
  this.isLite_ = data['type'] == 5;  // Lite account type is 5.
  this.contactPhones_ = data['contactPhones'];
  this.rnrSessionId_ = data['r'];

  var didDisplay = goog.dom.getElement('gc-number');
  if (this.did_) {
    didDisplay.textContent = this.did_['formatted'];
  }

  this.initPhoneNumberSelect_();

  if (this.isLite_) {
    this.showSms_.setVisible(false);
  } else {
    this.initQuickSms_();
  }
};

/**
 * Initialize the sms view.
 *
 * @private
 */
gc.Popup.prototype.initQuickSms_ = function() {
  this.initSmsNumberSelect_();
};

/**
 * Initializes the phone number entry.
 * Uses an autocomplete.
 *
 * @private
 */
gc.Popup.prototype.initPhoneNumberSelect_ = function() {
  var input = goog.dom.getElement('gc-quickcall-ac');

  // Init the contact auto complete
  var contactPhones = this.contactPhones_;
  var numbers = [];
  goog.object.forEach(contactPhones, function(val, idx, obj) {
    if (val['phoneTypeName'] != 'email') {
      numbers.push(new gc.ui.PhoneAutoComplete.Row(idx, val));
    }
  }, this);

  if (this.inputAc_) {
    this.inputAc_.disposeInternal();
  }

  this.inputAc_ = new gc.ui.PhoneAutoComplete(numbers, input);
  this.inputAc_.setMaxMatches(4);

  // Initiate call if ENTER pressed and autocomplete menu not showing.
  this.eventHandler_.listen(this.phoneNumberInput_.getElement(),
      goog.events.EventType.KEYPRESS, function(e) {
        if (e.keyCode == 13 && !this.inputAc_.isOpen()) {
          this.handleCallAction_(e);
        }
      });

  this.phoneNumberInput_.focusAndSelect();
};

/**
 * Handles a quick call action.
 *
 * @param {goog.events.Event} e Action event from a button.
 * @private
 */
gc.Popup.prototype.handleCallAction_ = function(e) {
  if (e.target == this.connect_ ||
      e.target == this.phoneNumberInput_.getElement() ||
      e.type == goog.events.EventType.SUBMIT) {
    var numberInput = this.phoneNumberInput_;
    var number = numberInput ? numberInput.getValue() : '';
    this.initCall_(number);
  } else {
    this.cancel_.setVisible(false);
    this.callMsg_.reset();
    this.connect_.setVisible(true);
    this.cancelCall_();
  }
};

/**
 * Called when the 'Connect' button is activated.
 * Checks for valid entries and sends the call request if all passed.
 *
 * @param {string} number The phone number to call.
 * @private
 */
gc.Popup.prototype.initCall_ = function(number) {
  var valid = true;

  if (this.isCallDisabled_) {
    return;
  }

  if (!number) {
    valid = false;
    this.isCallDisabled_ = false;
    this.callMsg_.show(gc.MSG_INVALID_NUMBER_SHORT,
        'gc-quickcall-err', gc.Popup.MESSAGE_DELAY);
  }

  // If valid inputs, initiate phone call.
  if (valid) {
    this.makeCall_(number);
    this.isCallDisabled_ = true;
  }
};

/**
 * Send the request to make a call.
 *
 * @param {string} number The phone number to call.
 * @private
 */
gc.Popup.prototype.makeCall_ = function(number) {
  this.connect_.setCaption(gc.MSG_CONNECTING);
  this.connect_.setEnabled(false);

  // Redirect to Moya to handle the actual call, either click2call or VoIP
  number = number.replace(/[^0-9+]/g, '');
  gc.goToInbox('/calls?a=nc,' + number);

  // Close popup as the redirection happens.
  goog.Timer.callOnce(window.close, 800);
};

/**
 * Cancel the phone call.
 * Sends a request to cancel the phone call.
 * TODO(brianp): Add callback to handle failed request.
 *
 * @param {string} number The phone number that was called.
 * @param {string} phone The forwarding number used.
 * @private
 */
gc.Popup.prototype.cancelCall_ = function(number, phone) {
  // Re-enable calls.
  this.isCallDisabled_ = false;

  gc.cancelCall(number, phone, this.rnrSessionId_);
};

/**
 * Resets the 'Cancel' and 'Connect' buttons, plus their status messages
 * back to original state.
 *
 * @private
 */
gc.Popup.prototype.resetButtons_ = function() {
  this.cancel_.setVisible(false);
  this.callMsg_.reset();
  this.connect_.setVisible(true);
  this.connect_.setActive(false);
  this.connect_.setCaption(gc.MSG_CONNECT);
  this.isCallDisabled_ = false;
};

// --- SMS methods ----------------------------------------------------------

/**
 * Initializes the phone number entry for SMS.
 * Uses an autocomplete.
 *
 * @private
 */
gc.Popup.prototype.initSmsNumberSelect_ = function() {
  var input = this.smsTo_;

  // Init the contact auto complete
  var contactPhones = this.contactPhones_;
  var numbers = [];
  goog.object.forEach(contactPhones, function(val, idx, obj) {
    numbers.push(new gc.ui.PhoneAutoComplete.Row(idx, val));
  }, this);

  if (this.smsInputAc_) {
    this.smsInputAc_.disposeInternal();
  }

  this.smsInputAc_ = new gc.ui.PhoneAutoComplete(numbers, input, true);
  this.smsInputAc_.setMaxMatches(4);
};

/**
 * Reset quick add.
 * Resets it back to it's original state. Clears and resets all inputs.
 *
 * @private
 */
gc.Popup.prototype.resetSms_ = function() {
  this.smsNumberInput_.clear();
  localStorage['smsTo'] = '';
  this.message_.value = '';
  localStorage['smsText'] = '';
  this.counterArea_.innerHTML = gc.Popup.SMS_LENGTH;
  this.send_.setCaption('Send');
  this.send_.setEnabled(true);
  this.smsMsg_.reset();
};

/**
 * Callback from change action on the SMS To: field.
 * Remembers what the value was in case the user closes the popup.
 * @param {goog.event.Event} e The key up event.
 * @private
 */
gc.Popup.prototype.handleSmsToChange_ = function(e) {
  localStorage['smsTo'] = this.smsTo_.value;
};

/**
 * Trigger the send sms request.
 * -Display a sending... msg.
 * -Construct the query data.
 * -Send the XHR.
 *
 * @param {goog.events.Event} e The event from the send button.
 * @private
 */
gc.Popup.prototype.sendSms_ = function(e) {
  // Don't send if their is no number or no text yet.
  if (!goog.string.isEmpty(this.message_.value) &&
      !goog.string.isEmpty(this.smsNumberInput_.getValue())) {
    this.send_.setEnabled(false);
    this.send_.setCaption('Sending...');
    this.smsMsg_.reset();

    var queryData = new goog.Uri.QueryData();
    queryData.add('id', '');
    queryData.add('phoneNumber', this.smsNumberInput_.getValue());
    queryData.add('text', this.message_.value);
    queryData.add('sendErrorSms', 0);
    queryData.set('_rnr_se', this.rnrSessionId_);

    goog.net.XhrIo.send(gc.getUrl(true, gc.Popup.SMS_URI_),
        goog.bind(this.sendSmsResponse_, this), 'POST',
        queryData.toString());
  }
};

/**
 * Response to the sendSms request.
 * -Hides the sms popup.
 * -Resets the contents.
 * -Shows the notification msg.
 *
 * @param {goog.events.Event} e The xhr event.
 * @param {goog.Uri.QueryData} queryData The query data sent with the request.
 * @private
 */
gc.Popup.prototype.sendSmsResponse_ = function(e, queryData) {
  var response = {};
  try {
    response = e.target.getResponseJson();
  } catch (err) {
    response = {'ok': false};
  }

  if (response['ok']) {
    this.retrySms_ = true;
    this.resetSms_();

    /**
     * @desc Status message when sms has been sent successfully.
     */
    var MSG_SMS_SENT = goog.getMsg('Text sent.');
    this.smsMsg_.show(MSG_SMS_SENT, 'gc-quickcall-msg',
        gc.Popup.MESSAGE_DELAY);
  } else {
    if (this.retrySms_) {
      this.retrySms_ = false;
      this.sendSms_();
      return;
    }

    var errorMsg = gc.MSG_QUICK_ACTION_ERROR;
    if (response['data']) {
      if (response['data']['code'] == '58') {
        /**
         * @desc Error message when too many sms sent at once.
         */
        var MSG_SMS_LIMIT = goog.getMsg('Too many at once.');
        errorMsg = MSG_SMS_LIMIT;
      } else if (response['data']['code'] == '66') {
        /**
         * @desc Error message when out of credit.
         */
        var MSG_SMS_CREDIT_LIMIT = goog.getMsg('Out of credit.');
        errorMsg = MSG_SMS_CREDIT_LIMIT;
      } else if (response['data']['code'] == '67') {
        /**
         * @desc Error message when destination is not supported.
         */
        var MSG_SMS_INVALID_DESTINATION =
          goog.getMsg('Destination not supported.');
        errorMsg = MSG_SMS_INVALID_DESTINATION;
      }
    }

    // Change button back to Send and enabled, then display error message.
    this.send_.setCaption('Send');
    this.send_.setEnabled(true);

    this.smsMsg_.show(errorMsg, 'gc-quickcall-err', gc.Popup.MESSAGE_DELAY);
  }
};

/**
 * Called on key press to check if the text limit has been reached.
 * If it has been reached then prevent text from being added to the field.
 *
 * @param {goog.events.Event} e The key press event on the text input.
 * @return {boolean} True to allow text input, false to prevent it.
 */
gc.Popup.limitTextInput = function(e) {
  var textInput = e.target;

  // If the user has exceeded the max characters for an sms
  // then prevent any text input.
  // Only allow text input after this if the user is deleting characters.
  if (textInput.value.length >= gc.Popup.SMS_MAX &&
      (e.keyCode != goog.events.KeyCodes.BACKSPACE &&
       e.keyCode != goog.events.KeyCodes.DELETE)) {
    e.stopPropagation();
    e.preventDefault();
    return false;
  }
  return true;
};

/**
 * Adjust the characters remaining counter for text messages.
 *
 * @param {Element} counterArea The element where the sms character counter
 *     is displayed.
 * @param {goog.events.Event} e The key up event on the text input.
 */
gc.Popup.adjustCounter = function(counterArea, e) {
  var textInput = e.target;
  var numTexts = Math.ceil((textInput.value.length + 1) /
                           gc.Popup.SMS_LENGTH);
  var count = gc.Popup.SMS_LENGTH - (textInput.value.length %
                                     gc.Popup.SMS_LENGTH);

  // When on 3rd message or higher, we just display a message.
  if (numTexts >= 3) {
    /**
     * @desc Message once a user's text message hasn't gotten really long.
     */
    var MSG_LONG_TEXT = goog.getMsg('Really?');
    counterArea.innerHTML = MSG_LONG_TEXT;
  } else if (numTexts == 2) {
    counterArea.innerHTML = goog.string.buildString(numTexts, '.', count);
  } else {
    counterArea.innerHTML = count;
  }

  localStorage['smsText'] = textInput.value;
};

// --- Inbox related methods ------------------------------------------------

/**
 * Load and display the inbox view.
 *
 * @private
 */
gc.Popup.prototype.loadInbox_ = function() {
  // Forces chrome to load async.
  goog.Timer.callOnce(goog.bind(function() {
    goog.net.XhrIo.send(gc.getUrl(true, gc.INBOX_URI),
        goog.bind(this.handleInboxResponse_, this), 'GET');
  }, this), 1);
};

/**
 * Handle response from inbox load.
 *
 * @param {goog.events.Event} e the Xhr event.
 * @private
 */
gc.Popup.prototype.handleInboxResponse_ = function(e) {
  if (e.target.getResponseText().length) {
    localStorage['loggedOut'] = '';
    this.messageData_ = e.target.getResponseJson();
    this.messageContacts_ = this.messageData_['contacts'];
    this.renderInbox_(this.messageData_);
    this.statusMsg_.reset();
  } else {
    gc.showLoggedOut();
    this.goToVoice_();
  }
};

/**
 * Display the inbox.
 *
 * @param {Object} messageData Object with message info.
 * @private
 */
gc.Popup.prototype.renderInbox_ = function(messageData) {
  this.previousPlayBtn_ = null;
  this.messageArea_ = goog.dom.getFirstElementChild(this.inboxContent_);
  goog.dom.removeChildren(this.messageArea_);

  if (messageData['messageList'].length) {
    goog.array.forEach(messageData['messageList'],
        function(message, idx, array) {
          this.messageArea_.appendChild(this.createMessageRow_(message));
        }, this);
  } else {
    var noMessages = $dom('div', {'class': 'gc-no-items'},
        'No items in your inbox.');
    this.messageArea_.appendChild(noMessages);
  }

  // If height greater than 520, then scrollbars exist. Adjust margin.
  if (goog.style.getSize(this.messageArea_).height > 510) {
    this.messageArea_.style.marginRight = '4px';
  } else {
    this.messageArea_.style.marginRight = '0px';
  }
};

/**
 * Create a single message dom row.
 *
 * @param {Object} message The info for the message.
 * @return {Element} A complete message row element.
 * @private
 */
gc.Popup.prototype.createMessageRow_ = function(message) {
  var fromText;

  var contact = {};
  var photoUrl;
  if (this.messageContacts_['contactPhoneMap'] && message['phoneNumber']) {
    contact = this.messageContacts_['contactPhoneMap'][message['phoneNumber']];
    fromText = contact ?
        contact['name'] || contact['displayNumber'] : 'Unknown';
  }

  fromText = fromText || message['displayNumber'];
  fromText = goog.string.unescapeEntities(fromText);

  if (contact && contact['photoUrl']) {
    photoUrl = 'https://www.google.com/s2/' +
        gc.getUrl(true, contact['photoUrl'], false, true) + '?sz=32';
  } else {
    photoUrl = 'images/blue_ghost.jpg';
  }

  var call = $dom('a', {'class': 'gc-message-action',
      'href': 'javascript://'}, 'Call');
  var sms = this.isLite_ ? '' : $dom('a', {'class': 'gc-message-action',
      'href': 'javascript://'}, 'Text');
  var archive = $dom('a', {'class': 'gc-message-action',
      'href': 'javascript://'}, 'Archive');
  var deleteLink = $dom('a', {'class': 'gc-message-action',
      'href': 'javascript://'}, 'Delete');

  var msgStatus = $dom('div', {'class': 'gc-message-status'}, $dom('span'));

  var player = $dom('div', {'style': 'display: none; margin: 0 0 0 -2px;'});

  var child = {};
  var playBtn = '';
  var messageContent = '';

  if (message['children']) {
    child = message['children'][message['children'].length - 1];

    messageContent = child ? child['message'] : '';

    if (message['type'] == 2 || message['type'] == 4) {
      // Type voicemail(2) or recording(4).
      var min = Math.floor(child['duration'] / 60);
      var sec = child['duration'] % 60;
      min = min < 10 ? '0' + min : min;
      sec = sec < 10 ? '0' + sec : sec;

      // Not used yet. Will be used when vm playback is working.
      playBtn = $dom('div', {'class': 'gc-message-play'},
          $dom('div', {'class': ''}, min + ':' + sec));

      var url = goog.string.buildString(
          goog.string.urlEncode(gc.getUrl(true, gc.Popup.AUDIO_URI_)),
          message['id'], '%3Fread%3D', 1);

      this.eventHandler_.listen(playBtn, goog.events.EventType.CLICK,
          goog.bind(this.playVoicemail_, this, true, player, playBtn,
              message['id'], url, msgStatus));
      this.eventHandler_.listen(player, goog.events.EventType.CLICK,
          function(e) {
            e.stopPropagation();
          });
    } else if (message['type'] == 11 || message['type'] == 10) {
      // Is an SMS. Type 11 and 10 are SMS types.
      if (message['children'].length <= 4) {
        messageContent = goog.array.map(message['children'],
            function(smsChild, idx, arr) {
          return this.createSmsLine_(smsChild['type'], fromText,
              smsChild['message']);
        }, this);
      } else {
        var smsChild = message['children'][0];
        var first = this.createSmsLine_(smsChild['type'], fromText,
            smsChild['message']);

        var hidden = [];
        for (var i = 1; i < message['children'].length - 2; i++) {
          var smsChild = message['children'][i];
          var hiddenSms = this.createSmsLine_(smsChild['type'], fromText,
              smsChild['message']);
          hidden.push(hiddenSms);
        }

        var hiddenSec = $dom('div', {'style': 'display: none;'}, hidden);

        var show = $dom('div', {'class': 'gc-message-sms-more'},
            message['children'].length - 3 + ' more messages');

        goog.events.listenOnce(show, goog.events.EventType.CLICK, function() {
          goog.style.setElementShown(show, false);
          goog.style.setElementShown(hiddenSec, true);
        }, this);

        smsChild = message['children'][message['children'].length - 2];
        var secondLast = this.createSmsLine_(smsChild['type'], fromText,
            smsChild['message']);

        smsChild = message['children'][message['children'].length - 1];
        var last = this.createSmsLine_(smsChild['type'], fromText,
            smsChild['message']);

        messageContent = [first, show, hiddenSec, secondLast, last];
      }
    }
  }

  var messageRow = $dom('div',
      {'class': message['isRead'] ? 'gc-message-read' : 'gc-message-unread'},
      $dom('div', {'class': 'gc-message-top'},
        $dom('div', {'class': 'gc-message-portrait'},
          $dom('img', {'src': photoUrl}),
          $dom('div', {'class': 'gc-message-icon-' + message['type']})),
        $dom('div', {'class': 'gc-message-info'},
          $dom('div', {},
            $dom('div', {'class': 'goog-inline-block gc-message-title'},
                fromText),
            $dom('div', {'class': 'goog-inline-block'})),
          $dom('div', {'style': 'color: #666'}, message['relativeStartTime'])),
        $dom('div', {'class': 'clear'}, ''),
        $dom('div', {'class': 'gc-message-text'},
            messageContent),
        msgStatus),
      $dom('div', {'class': 'gc-message-actions'},
          playBtn, player,
          $dom('div', {},
              call, sms, archive, deleteLink)));

  this.eventHandler_.listen(call, goog.events.EventType.CLICK,
      goog.bind(this.switchTab_, this, 'call', message['displayNumber'],
          false));

  if (sms) {
    this.eventHandler_.listen(sms, goog.events.EventType.CLICK,
        goog.bind(this.switchTab_, this, 'sms', message['displayNumber'],
            false));
  }

  this.eventHandler_.listen(archive, goog.events.EventType.CLICK,
      goog.bind(this.messageAction_, this, messageRow, 'archive',
          message['id'], null));
  this.eventHandler_.listen(deleteLink, goog.events.EventType.CLICK,
      goog.bind(this.messageAction_, this, messageRow, 'delete',
          message['id'], null));

  if (!message['isRead']) {
    this.eventHandler_.listen(messageRow, goog.events.EventType.CLICK,
        goog.bind(this.messageAction_, this, messageRow, 'read',
            message['id'], msgStatus));
  }

  return messageRow;
};

/**
 * Create the dom for an sms line.
 *
 * @param {number} type Type of conversation (id).
 * @param {string} contact The contact name.
 * @param {string} text The SMS text.
 * @return {Element} The SMS row text.
 * @private
 */
gc.Popup.prototype.createSmsLine_ = function(type, contact, text) {
  return $dom('div', {'class': 'gc-message-sms-row'},
      $dom('span', {'class': 'gc-message-sms-from'},
          (type == 10 ? contact : 'Me') + ': '),
      $dom('span', {'class': 'gc-message-sms-text'}, text));
};

/**
 * Animate mark as read.
 *
 * @param {Element} element The element to animate with.
 * @private
 */
gc.Popup.prototype.animateMarkRead_ = function(element) {
  var anim = new goog.fx.dom.FadeOut(element, 400);
  anim.play();
};

/**
 * Handle a message action.
 *
 * @param {Element} messageRow The message row element.
 * @param {string} action The action to take.
 * @param {string} conversationId The unique conversation id.
 * @param {Element} element Secondary element.
 * @param {goog.events.Event} e The event that triggered the action.
 * @private
 */
gc.Popup.prototype.messageAction_ = function(messageRow, action,
    conversationId, element, e) {
  var queryData = new goog.Uri.QueryData();
  queryData.add('messages', [conversationId]);
  queryData.set('_rnr_se', this.rnrSessionId_);

  switch (action) {
    case 'read':
      queryData.add('read', '1');

      goog.net.XhrIo.send(gc.getUrl(true, gc.Popup.MARK_URI_),
          goog.bind(this.messageActionResponse_, this, messageRow, action,
              conversationId, element),
          'POST', queryData.toString());

      this.animateMarkRead_(element);
      break;
    case 'archive':
      queryData.add('archive', '1');

      goog.net.XhrIo.send(gc.getUrl(true, gc.Popup.ARCHIVE_URI_),
          goog.bind(this.messageActionResponse_, this, messageRow, action,
              conversationId, element),
          'POST', queryData.toString());

      var anim = new goog.fx.dom.FadeOutAndHide(messageRow, 600);
      anim.play();
      break;
    case 'delete':
      queryData.add('trash', '1');

      goog.net.XhrIo.send(gc.getUrl(true, gc.Popup.DELETE_URI_),
          goog.bind(this.messageActionResponse_, this, messageRow, action,
              conversationId, element),
          'POST', queryData.toString());

      var anim = new goog.fx.dom.FadeOutAndHide(messageRow, 600);
      anim.play();
      break;
  }

  if (e) {
    e.stopPropagation();
  }
};

/**
 * Response to a message action request.
 *
 * @param {Element} messageRow The message row element.
 * @param {string} action The action to take.
 * @param {string} conversationId The unique conversation id.
 * @param {Element} element Secondary element.
 * @param {goog.events.Event} e The xhr event.
 * @private
 */
gc.Popup.prototype.messageActionResponse_ = function(messageRow, action,
    conversationId, element, e) {

  var response = {};
  try {
    response = e.target.getResponseJson();
  } catch (err) {
    response = {'ok': false};
  }

  if (response['ok']) {
    this.retryAction_ = true;

    switch (action) {
      case 'archive':
      case 'delete':
        this.statusMsg_.show('Loading...');
        this.loadInbox_();
        break;
    }
  } else if (this.retryAction_) {
    this.retryAction_ = false;
    this.messageAction_(messageRow, action, conversationId, element);
  }
};

/**
 * Play the voicemail.
 * Creates the swf object and appends it to the view. Destructs the previous
 * one.
 *
 * NOTE(brianp): Not used yet. Will be used when the server side has needed
 * values.
 *
 * @param {boolean} show True to show the player, false to hide.
 * @param {Element} player The element to put the player into.
 * @param {Element} button The play button element.
 * @param {string} messageId The id of the message voicemail to play.
 * @param {string} url The url where the voicemail file is located.
 * @param {Element} msgStatus The status element.
 * @param {goog.events.Event} e The event that triggered the action.
 * @private
 */
gc.Popup.prototype.playVoicemail_ = function(show, player, button, messageId,
    url, msgStatus, e) {
  goog.style.setElementShown(button, !show);

  if (this.previousPlayBtn_) {
    goog.style.setElementShown(this.previousPlayBtn_, true);
  }

  if (show) {
    goog.style.setElementShown(player, true);

    // Retrieve a reference to the container and clear its elements.
    var targId = 'gc-flash-messageplayer';
    var swfId = 'gc-audioPlayer';

    if (goog.dom.getElement(swfId)) {
      swfobject.removeSWF(swfId);
    }

    // Re-create the container element.
    var newEl = $dom('div', {'id': targId});
    var path = 'https://www.google.com' + this.messageData_['swfPlayer'];

    // Create flash movie and append it to container.
    var flashvars = {
      'messagePath': url,
      'baseurl': goog.string.urlEncode(gc.Background.VOICE_URL),
      'conv': messageId
    };

    var params = {
      'wmode': 'transparent',
      'data': path
    };
    var attributes = {
      'id': swfId,
      'movie': path,
      'name': swfId
    };

    player.appendChild(newEl);

    swfobject.embedSWF(path, targId, '100%', '20', '8.0.0',
        'expressInstall.swf', flashvars, params, attributes);

    this.animateMarkRead_(msgStatus);
  } else {
    if (player.style.display == '') {
      goog.style.setElementShown(player, false);
    }
  }

  this.previousPlayBtn_ = button;

  e.stopPropagation();
};


/**
 * CallWidget class used to operate the call widget.
 *
 * @param {Element} el The element to position the call widget against.
 * @constructor
 */
gc.CallWidget = function(el) {
  this.retry_ = true;
  var contents = this.createWidgetContents_();
  this.popup_ = new goog.ui.Popup(contents);
  this.element_ = goog.dom.getElement(el);

  this.updatePhones_();

  this.popup_.setAutoHide(true);
  this.popup_.setMargin(10, 10, 10, 10);
  this.popup_.setPosition(new goog.positioning.AnchoredViewportPosition(
      this.element_,
      goog.positioning.Corner.TOP_LEFT));

  this.reloadWidget();

  this.eventHandler_ = new goog.events.EventHandler(this);

  this.eventHandler_.listen(this.closeBtn_,
      goog.events.EventType.CLICK, function(e) {
        this.popup_.setVisible(false);
      });

  this.eventHandler_.listen(this.popup_, goog.ui.PopupBase.EventType.HIDE,
      function(e) {
        chrome.extension.sendMessage({'action': 'closeWidget'});
      });
};

/**
 * URL to initiate a call.
 * @private {string}
 */
gc.CallWidget.CALL_URL_ = 'https://www.google.com/voice/call/connect/';

/**
 * URL to cancel a call.
 * @private {string}
 */
gc.CallWidget.CANCEL_URL_ = 'https://www.google.com/voice/call/cancel/';

/**
 * Length of time (in ms) to display 'Calling' message.
 * @type {number}
 */
gc.CallWidget.MESSAGE_DELAY = 12000;

/**
 * Length of time (in ms) to display 'Cancel' button before
 * we reset to original state.
 * @type {number}
 */
gc.CallWidget.RESET_DELAY = 35000;


/**
 * Re-initializes the CallWidget with the number passed as the hash
 * to this widget.
 */
gc.CallWidget.prototype.reloadWidget = function() {
  var hash = window.location.hash;
  // Remove # from hash string.
  var number = hash.substring(1);
  this.number_ = number;
  goog.dom.setTextContent(this.numberEl_, number);
  this.popup_.setVisible(true);
  chrome.extension.sendMessage({'action': 'resizeWidget'});
};

/**
 * Makes request to get phone information from the background script.
 *
 * @private
 */
gc.CallWidget.prototype.updatePhones_ = function() {
  chrome.extension.sendMessage({'action': 'phones'},
      goog.bind(this.handleDataResponse_, this));
};

/**
 * Create the DOM contents for the call widget.
 *
 * @return {Element} DOM contents for the call widget.
 * @private
 */
gc.CallWidget.prototype.createWidgetContents_ = function() {
  this.numberEl_ = $dom('span', {'class': 'gc-cs-number'}, '(408) 555-5555');
  var phoneSelect = $dom('div', {'class': 'gc-cs-phone'});
  var connect = $dom('div', {'class': 'gc-cs-connect'}, 'Connect');
  this.closeBtn_ = $dom('img',
      {'src': chrome.extension.getURL('images/lilac-close.png')});
  var header = $dom('div', {'class': 'gc-cs-calli'},
      $dom('span', {'class': 'gc-cs-call'}, 'Call '),
      this.numberEl_,
      this.closeBtn_);

  var html = $dom('div', {'class': 'gc-call-popup'},
      header,
      $dom('div', {'class': 'gc-cs-content'},
          $dom('div', {},
              $dom('div', {'class': 'gc-cs-cwith'}, 'Phone to call with'),
              phoneSelect),
          $dom('div', {},
              connect,
              $dom('div', {'id': 'gc-quickcall-msg', 'style': 'display: none',
                           'class': 'goog-inline-block gc-quickcall-msg'}))));

  document.body.appendChild(html);

  header.style.backgroundImage =
      'url(' + chrome.extension.getURL('bubble-19.png') + ')';

  var dropdown = $$('div', 'goog-flat-menu-button-dropdown', phoneSelect)[0];
  dropdown.style.backgroundImage =
      'url(' + chrome.extension.getURL('toolbar_icons.gif') + ')';

  this.connect_ = gc.CallWidget.decorateButton(connect);

  this.callMsg_ = gc.Notification.getInstance('gc-quickcall-msg');

  return html;
};

/**
 * Handle the data response that is returned from the background script.
 *
 * @param {Object} response The response object with data about the response.
 * @private
 */
gc.CallWidget.prototype.handleDataResponse_ = function(response) {
  if (response['phones']) {
    this.did_ = response['did'];
    this.rnrSessionId_ = response['r'];
  }
};

/**
 * Resets the 'Cancel' and 'Connect' buttons, plus their status messages
 * back to original state.
 *
 * @private
 */
gc.CallWidget.prototype.resetButtons_ = function() {
  this.callMsg_.reset();
  this.connect_.setEnabled(true);
  this.connect_.setCaption(gc.MSG_CONNECT);
  this.connect_.setActive(false);
};

/**
 * Sets whether to disable or enable the auto hiding by adjusting the region.
 *
 * NOTE(brianp): We set the auto hide region instead of calling popup's
 * setAutoHide method. The reason for this is so that you can set the auto
 * hide state while the popup is open. This is needed when there are popups
 * inside the main popup and we don't want to hide the
 * popup when someone clicks on one of the popups/menus inside the main one.
 *
 * @param {boolean} autoHide Whether to hide if user clicks outside the popup.
 */
gc.CallWidget.prototype.setAutoHideRegion = function(autoHide) {
  if (autoHide) {
    this.popup_.setAutoHideRegion(null);
  } else {
    this.popup_.setAutoHideRegion(goog.dom.getDocument().body.firstChild);
  }
};

/**
 * Decorate the given div element as a Closure CustomButton.
 *
 * @param {Element} divElement The div element to decorate.
 * @param {goog.ui.ControlRenderer=} opt_renderer Optional renderer to use.
 * @return {goog.ui.CustomButton} The custom button object.
 */
gc.CallWidget.decorateButton = function(divElement, opt_renderer) {
  var button = new goog.ui.CustomButton(null,
      opt_renderer || goog.ui.style.app.ButtonRenderer.getInstance());
  button.decorate(divElement);
  return button;
};




// Exports.
goog.exportSymbol('Voice', gc.Background);
goog.exportProperty(gc.Background.prototype, 'init',
    gc.Background.prototype.init);
goog.exportSymbol('VoicePopup', gc.Popup);
goog.exportSymbol('CallWidget', gc.CallWidget);
goog.exportProperty(gc.CallWidget.prototype, 'reloadWidget',
    gc.CallWidget.prototype.reloadWidget);
