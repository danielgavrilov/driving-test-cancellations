var Q = require('q');
var clc = require('cli-color');
var assert = require('assert');
var prompt = require('prompt');
var moment = require('moment');
var zombie = require('zombie');
var nodemailer = require('nodemailer');
var config = require('./config');

var browser = new zombie;
var dateFormat = 'dddd D MMMM YYYY h:mma';
var currentTestDate;

var transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: config.GMAIL_USERNAME,
        pass: config.GMAIL_PASSWORD
    }
});

var mailOptions = {
    from: 'Cancellation Finder',
    to: config.RECIPIENT,
    subject: 'CANCELLATION FOUND',
    text: ''
};

function timestamp() {
  return moment().format('DD/MM/YYYY HH:mm:ss:');
}

function log(message) {
  console.log(clc.blackBright(timestamp()), message);
}

function logError(message) {
  log(clc.red(message));
}

function contains(text, string) {
  return text.indexOf(string) > -1 ? true : false;
}

function sendMessage(message) {
  mailOptions.text = message;
  transporter.sendMail(mailOptions, function(error, info) {
    if (error) {
        logError('Couldn\'t send email: ' + error);
    } else {
        log('Message sent: ' + info.response);
    }
  });
}

function notify(dates) {
  var message = 'Found the following dates: \n\n' + dates.join('\n');
  log(clc.green(message));
  sendMessage(message);
}

function getTestDate() {
  var text = browser.query('#confirm-booking-details')
    .querySelectorAll('section')[0]
    .querySelectorAll('dd')[0]
    .innerHTML;

  return moment(text, dateFormat);
}

function findCaptchaURL() {
  var elem = browser.query('#recaptcha_challenge_image');
  if (elem) return elem.src;
}

function solveCaptcha() {
  var deferred = Q.defer();
  var captchaURL = findCaptchaURL(browser);
  if (captchaURL) {
    logError('Captcha found: \n' + captchaURL);
    prompt.start();
    prompt.get(['captcha'], function(error, result) {
      browser.fill('#recaptcha_response_field', result.captcha);
      if (browser.query('#recaptcha-submit')) deferred.resolve(browser.pressButton('#recaptcha-submit'))
      else deferred.resolve(browser);
    });
  } else {
    deferred.resolve(browser);
  }
  return deferred.promise;
}

function login() {
  log('login');
  assert(browser.window.location.pathname == '/login', 'Did not reach login page.');
  return browser
    .fill('#driving-licence-number', config.LICENCE_NUMBER)
    .fill('#application-reference-number', config.APPLICATION_REFERENCE_NUMBER)
    .pressButton('#booking-login');
}

function gotoChange() {
  log('gotoChange');
  assert(browser.window.location.pathname == '/manage', 'Did not reach manage page.');
  currentTestDate = getTestDate();
  return browser.clickLink('#date-time-change');
}

function findDates() {
  log('findDates');
  assert(browser.window.location.pathname == '/manage' && contains(browser.window.location.search, '?execution=e1s2'), 'Did not reach find dates page.');
  return browser.pressButton('#driving-licence-submit');
}

function listDates() {
  log('listDates');
  assert(browser.window.location.pathname == '/manage' && contains(browser.window.location.search, '?execution=e1s3'), 'Did not reach list dates page.');

  var dates = browser.queryAll('.slotDateTime')
    .map(function(elem) { 
      return moment(elem.innerHTML, dateFormat); 
    })
    .filter(function(date) {
      return date.isBefore(currentTestDate);
    })
    .map(function(date) { 
      return date.format(dateFormat); 
    });

  if (dates.length > 0) {
    notify(dates);
  } else {
    log('No cancellations found.');
  }

  return browser;
}

function main() {
  browser.visit(config.LOGIN_URL)
    // Going to avoid captchas by extending the time between checks.
    // .then(solveCaptcha)
    .then(login)
    .then(gotoChange)
    .then(findDates)
    // .then(solveCaptcha)
    .then(listDates)
    .fail(function(error) {
      logError(error);
    });
}

main();

setInterval(main, 1000*60*45); // Check every 45min