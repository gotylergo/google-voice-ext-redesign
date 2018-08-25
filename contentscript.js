// Copyright 2010 Google Inc. All Rights Reserved.

/**
 * @fileoverview Content script for turning phone numbers into clickable
 * links for making Google Voice calls.
 *
 * TODO(brianp): Stuff that's shared between the content script, background,
 * and popup should be moved to a common dependency file.
 *
 * @author brianp@google.com (Brian Peterson)
 */

goog.provide('gc');

goog.require('goog.dom');
goog.require('goog.dom.TagName');
goog.require('goog.dom.classes');
goog.require('goog.events.EventHandler');
goog.require('goog.ui.Popup');


var $dom = goog.dom.createDom;
var $$ = goog.dom.getElementsByTagNameAndClass;

gc.TAGS_TO_IGNORE_ = {
  'SCRIPT': 1,
  'STYLE': 1,
  'HEAD': 1,
  'OBJECT': 1,
  'TEXTAREA': 1,
  'INPUT': 1,
  'SELECT': 1,
  'A': 1
};

var callWidgetPopup;
var callWidgetIframe;


/**
 * Initializes the CallWidget and displays it.
 *
 * @param {Element} link The phone number link element.
 * @param {string} number The phone number to call.
 */
gc.callWithGoogleVoice = function(link, number) {
  // Render the widget iframe in a popup. The iframe is set to 1px in size and
  // at a low z-index to avoid a 300x300 white iframe from being rendered in
  // front of the user. A request is sent later to resize the iframe after the
  // iframe is rendered.

  var url = chrome.extension.getURL('widget.html#' + number);
  if (!callWidgetIframe) {
    callWidgetIframe = goog.dom.createDom(goog.dom.TagName.IFRAME, {
      'src': url,
      'height': '0px',
      'width': '0px',
      'allowTransparency': 'true',
      'frameborder': 0,
      'style': 'z-index: -1000; position: absolute;'
    });
  } else {
    callWidgetIframe.src = url;
  }
  callWidgetIframe.onload = onCallWidgetIframeLoaded;

  callWidgetPopup = new goog.ui.Popup(callWidgetIframe);
  callWidgetPopup.setAutoHide(true);
  callWidgetPopup.setMargin(10, 10, 10, 10);
  callWidgetPopup.setPosition(new goog.positioning.AnchoredViewportPosition(
      link, goog.positioning.Corner.TOP_RIGHT));

  callWidgetPopup.setVisible(true);
  goog.dom.appendChild(goog.dom.getDocument().body, callWidgetIframe);
};

var isActive = false;
var linkCount = 0;

/**
 * When user selects some text on the page, detect if it's a number
 * and show the call popup if we think it's a number.
 *
 * @param {goog.events.Event} e The mouse up event.
 */
function onNumberSelection(e) {
  // Makes re more generous for numbers since the user has
  // selected the number text.
  var re = /(^|\s)((\d{3}[ \-]\d{4}[ \-]\d{4})|(\d{2}[ \-\.]?){5}|(\d{3,4}[ \-]?\d{3}[ \-]?\d{2}[ \-]?\d{2,3}))(\s|$)/m;

  try {
    var selectedText =
        window.getSelection().getRangeAt(0).cloneContents().textContent;

    if (selectedText) {
      var match = re.exec(selectedText);
      if (match && match.length) {
        var number = match[2];
        gc.callWithGoogleVoice(e.target, number);
      }
    }
  } catch (err) {
    // pass.
  }
}

/**
 * Finds phone numbers on the page and converts them to clickable
 * links that display the call widget.
 */
function numberLink(startNode) {
  var re = /(^|\s)((\+1\d{10})|((\+1[ \.])?\(?\d{3}\)?[ \-\.\/]{1,3}\d{3}[ \-\.]{1,2}\d{4}))(\s|$)/m;

  var node, text = document.evaluate('.//text()[normalize-space(.) != ""]',
      startNode, null,
      XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null);

  for (var i = 0; i < text.snapshotLength; i++) {
    node = text.snapshotItem(i);
    var match = re.exec(node.textContent);
    if (match && match.length) {
      var number = match[2];
      var numberId = 'gc-number-' + linkCount;

      var link = '<span id="' + numberId +
          '" class="gc-cs-link"' +
          'title="Call with Google Voice">' +
          number + '</span>';

      if (node.parentNode &&
          !(node.parentNode.nodeName in gc.TAGS_TO_IGNORE_) &&
          !goog.dom.classes.has(node.parentNode, 'gc-cs-link')) {
        try {
          // Only convert number if it doesn't have an ancestor
          // with the attribute googlevoice="nolinks".
          var ignoreText = document.evaluate(
              'ancestor-or-self::*[@googlevoice = "nolinks"]',
              node, null,
              XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null);

          if (!ignoreText.snapshotLength) {
            if (node.parentNode.childElementCount == 0) {
              // If our parent has no child elements, we can just replace the
              // innerHTML in the parent node with text that includes the link.
              var oldHtml = node.parentNode.innerHTML;
              var newText = oldHtml.replace(number, link);
              node.parentNode.innerHTML = newText;
            } else {
              // The parent has child elements. We'll need to create a new span
              // element that contains the node's data, and replace only its
              // innerHTML. (Changing the innerHTML of the parent breaks all of
              // the event handlers for our siblings, which is bad.)
              var oldHtml = node.data;
              var newText = oldHtml.replace(number, link);
              var spanEl = goog.dom.createDom(goog.dom.TagName.SPAN);
              spanEl.innerHTML = newText;
              goog.dom.insertSiblingAfter(spanEl, node);
              goog.dom.removeNode(node);
            }

            var linkEl = goog.dom.getElement(numberId);
            if (linkEl) {
              linkCount++;
              goog.events.listen(linkEl, goog.events.EventType.CLICK,
                  goog.partial(gc.callWithGoogleVoice, linkEl, number));
            }
          }
        } catch (e) {
          // pass.
        }
      }
    }
  }
}

/**
 * Called when the DOM has been modified.
 * @param {goog.events.Event} e The node inserted event.
 */
function onDomChange(e) {
  if (!isActive) {
    isActive = true;
    numberLink(e.target);
    isActive = false;
  }
}

/**
 * Handles a custom DOM event 'callWithGoogleVoice'.
 * @param {goog.events.Event} e Event object.
 */
function onCallWithGoogleVoiceEvent(e) {
  var number = /** @type {string} */ (e.target.getAttribute('data-phone-number'));
  if (number) {
    gc.callWithGoogleVoice(e.target, number);
  }
}

/**
 * Called when call widget iframe is loaded.
 * @param {Object} e  event object
 */
function onCallWidgetIframeLoaded(e) {
  // Resize or close the widget if needed.
  chrome.extension.onMessage.addListener(
    function(request, sender, sendResponse) {
      if (request['action'] == 'closeWidget') {
        if (callWidgetPopup) {
          callWidgetPopup.setVisible(false);
          callWidgetIframe.src = '';
          callWidgetIframe.height = '1px';
          callWidgetIframe.width = '1px';
        }
      } else if (request['action'] == 'resizeWidget') {
        callWidgetIframe.width = '300px;';
        callWidgetIframe.height = '300px;';
        callWidgetIframe.style.zIndex = '1000';
      }
    }
  );
}

// Initialize if user has option turned on.
if ('text/xml' != document.contentType &&
    'application/xml ' != document.contentType) {
  chrome.extension.sendMessage({action: 'links'}, function(response) {

    // Add a marker CSS class to document body and listen for a custom DOM
    // event ('callWithGoogleVoice').
    if (!response['loggedOut']) {
      document.body.className += ' hasGoogleVoiceExt';
      goog.events.listen(document.body, 'callWithGoogleVoice',
          onCallWithGoogleVoiceEvent);
    }

    // Don't make numbers call links if Skype extension is installed.
    var skypeInstalled = goog.dom.getElement('skype_plugin_object');

    if (!skypeInstalled && !response['linksOff'] && !response['loggedOut']) {
      numberLink(document.body);
      goog.events.listen(document.body, 'DOMNodeInserted', onDomChange);
    } else {
      goog.events.unlisten(document.body, 'DOMNodeInserted', onDomChange);
    }

    if (!response['selectOff'] && !response['loggedOut']) {
      goog.events.listen(document.body, goog.events.EventType.MOUSEUP,
          onNumberSelection);
    }
  });
}
