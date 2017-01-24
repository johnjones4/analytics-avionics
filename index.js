const express = require('express');
const OAuth = require('oauth');
const logger = require('morgan');
const request = require('request');
const async = require('async');
const net = require('net');
const config = require('./config');
const bodyParser = require('body-parser');

const googleCallback = config.urlRoot + '/login/done';
const googleURLRoot = 'https://www.googleapis.com/analytics/v3/';
const selected = {};
const oauth = {};

const oauthClient = new OAuth.OAuth2(
  config.google.key,
  config.google.secret,
  '',
  'https://accounts.google.com/o/oauth2/auth',
  'https://accounts.google.com/o/oauth2/token',
  null
);

const socketServer = net.createServer(function(socket) {
  console.log('Socket opened');
  const interval = setInterval(function() {
    if (oauth.token && selected.profile) {
      const now = new Date();
      request.post({
        'url': 'https://analyticsreporting.googleapis.com/v4/reports:batchGet',
        'auth': {
          'bearer': oauth.token
        },
        'body': {
          'reportRequests': [
            {
              'viewId': selected.profile,
              'dateRanges': [
                {
                  'startDate': formatDate(now),
                  'endDate': formatDate(now)
                }
              ],
              'metrics': [
                {
                  'expression': 'ga:hits'
                }
              ]
            }
          ]
        },
        'json': true
      },function(err,res,body) {
        if (err) {
          console.error(err);
        } else if (body.reports.length > 0) {
          socket.write(body.reports[0].data.totals[0].values[0] + '\n');
        }
      });
    } else {
      socket.write('0\n');
    }
  },5000);
  socket.on('error',function() {
    console.log('Socket closed')
    clearInterval(interval);
  });
  socket.on('close',function() {
    console.log('Socket closed')
    clearInterval(interval);
  });
});
socketServer.listen(config.socketPort,'0.0.0.0');

const app = express();
app.use(logger('combined'));
app.use(bodyParser.urlencoded({
  'extended': true
}));
app.use(bodyParser.json({}));
app.set('view engine', 'ejs');

app.get('/',function(req,res,next) {
  if (oauth.token) {
    showChooser(req,res,next);
  } else {
    res.render('login',{});
  }
});
app.post('/',function(req,res,next) {
  selected.account = req.body.accounts;
  selected.property = req.body.properties;
  selected.profile = req.body.profiles;
  showChooser(req,res,next);
});

app.get('/login',function(req,res,next) {
  const authURL = oauthClient.getAuthorizeUrl({
    'response_type': 'code',
    'redirect_uri': googleCallback,
    'scope': [
      'https://www.googleapis.com/auth/plus.login',
      'https://www.googleapis.com/auth/analytics.readonly'
    ].join(' '),
    'state': new Date().getTime(),
    'access_type': 'offline',
    'approval_prompt': 'force'
  });
  res.redirect(authURL);
});
app.get('/login/done',function(req,res,next) {
  const code = req.query.code;
  const now = new Date().getTime();
  oauthClient.getOAuthAccessToken(
    code,
    {
      'grant_type': 'authorization_code',
      'redirect_uri': googleCallback
    },
    function(err,accessToken,refreshToken,params) {
      if (err) {
        next(err);
      } else {
        oauth.token = accessToken;
        oauth.refresh = refreshToken;
        oauth.expires = new Date(now + (params.expires_in * 1000));
        res.redirect('/');
      }
    }
  );
});

app.listen(config.expressPort,function() {
  console.log('Running');
});

function showChooser(req,res,next) {
  var handler = function(next1) {
    return function(err,data) {
      if (err) {
        next1(err);
      } else {
        var object = JSON.parse(data);
        if (object.items && object.items.forEach) {
          next1(null,object.items);
        } else {
          next1(null,[]);
        }
      }
    }
  };
  async.parallel({
    'accounts': function(next1) {
      oauthClient.get(googleURLRoot+'management/accounts',oauth.token,handler(next1));
    },
    'properties': function(next1) {
      if (selected.account) {
        oauthClient.get(googleURLRoot+'management/accounts/' + selected.account + '/webproperties',oauth.token,handler(next1));
      } else {
        next1(null,[])
      }
    },
    'profiles': function(next1) {
      if (selected.account && selected.property) {
        oauthClient.get(googleURLRoot+'management/accounts/' + selected.account + '/webproperties/' + selected.property + '/profiles',oauth.token,handler(next1));
      } else {
        next1(null,[])
      }
    }
  },function(err,options) {
    res.render('chooser',{
      'selected': selected,
      'options': options
    });
  })
}

function formatDate(dateObj) {
  var prependZero = function(val) {
    if (val < 10) {
      return '0' + val;
    } else {
      return val;
    }
  }
  return [dateObj.getFullYear(),prependZero(dateObj.getMonth()+1),prependZero(dateObj.getDate())].join('-');
}
