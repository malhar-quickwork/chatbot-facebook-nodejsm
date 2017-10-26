'use strict';

const apiai = require('apiai');
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const uuid = require('uuid');
var webshot = require('webshot');

// var $ = require('jquery'),
//     XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;
//
// $.support.cors = true;
// $.ajaxSettings.xhr = function() {
//     return new XMLHttpRequest();
// };

var ADODB = require('node-adodb');
var connection = ADODB.open('Provider=Microsoft.Jet.OLEDB.4.0;Data Source=Database1.mdb;');
process.env.DEBUG = 'ADODB';

// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
	throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
	throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
	throw new Error('missing API_AI_CLIENT_ACCESS_TOKEN');
}
if (!config.FB_APP_SECRET) {
	throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
	throw new Error('missing SERVER_URL');
}



app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
	verify: verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
	extended: false
}))

// Process application/json
app.use(bodyParser.json())

var http = require('http');
http.createServer(function(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/html'
  });
  res.write('<!doctype html>\n<html lang="en">\n' +
    '\n<meta charset="utf-8">\n<title></title>\n' +
    '<style type="text/css">* {font-family:arial, sans-serif;}</style>\n' +
    '\n\n<h1>Set a message to be sent</h1>\n' +
    '<div id="content"><form action="/setmessage/" method="post">Message:<br><input type="text" name="message"><br>Time Interval:<br><input type="time" name="interval"><br><br><input type="submit" value="Submit"></div>' +
    '\n\n');
  res.end();
}).listen(5000, '127.0.0.1');
console.log('Server running at http://127.0.0.1:8888');


const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
	language: "en",
	requestSource: "fb"
});
const sessionIds = new Map();

// Index route
app.get('/', function (req, res) {
	res.send('Hello world, I am a chat bot')
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
	console.log("request");
	if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Failed validation. Make sure the validation tokens match.");
		res.sendStatus(403);
	}
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
	var data = req.body;
	console.log(JSON.stringify(data));



	// Make sure this is a page subscription
	if (data.object == 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function (pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function (messagingEvent) {
				if (messagingEvent.optin) {
					receivedAuthentication(messagingEvent);
				} else if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				} else if (messagingEvent.delivery) {
					receivedDeliveryConfirmation(messagingEvent);
				} else if (messagingEvent.postback) {
					receivedPostback(messagingEvent);
				} else if (messagingEvent.read) {
					receivedMessageRead(messagingEvent);
				} else if (messagingEvent.account_linking) {
					receivedAccountLink(messagingEvent);
				} else {
					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
				}
			});
		});

		// Assume all went well.
		// You must send back a 200, within 20 seconds
		res.sendStatus(200);
	}
});



function receivedMessage(event) {

	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;

	if (!sessionIds.has(senderID)) {
		sessionIds.set(senderID, uuid.v1());
	}
	//console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	//console.log(JSON.stringify(message));

	var isEcho = message.is_echo;
	var messageId = message.mid;
	var appId = message.app_id;
	var metadata = message.metadata;

	// You may get a text or attachment but not both
	var messageText = message.text;
	var messageAttachments = message.attachments;
	var quickReply = message.quick_reply;

	if (isEcho) {
		handleEcho(messageId, appId, metadata);
		return;
	} else if (quickReply) {
		handleQuickReply(senderID, quickReply, messageId);
		return;
	}


	if (messageText) {
		//send message to api.ai
		sendToApiAi(senderID, messageText);
	} else if (messageAttachments) {
		handleMessageAttachments(messageAttachments, senderID);
	}
}


function handleMessageAttachments(messageAttachments, senderID){
	//for now just reply
	sendTextMessage(senderID, "Attachment received. Thank you.");
}

function handleQuickReply(senderID, quickReply, messageId) {
	var quickReplyPayload = quickReply.payload;
	console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
	//send payload to api.ai
	sendToApiAi(senderID, quickReplyPayload);
}

//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
	// Just logging message echoes to console
	console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}

function handleApiAiAction(sender, action, responseText, contexts, parameters) {
		var qs="";
	switch (action) {
		case "trial":
		console.log(action);
			qs="SELECT SUM(IIF(Celin > 20,1,0)) AS Morethan20,SUM(IIF(Celin BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF(Celin BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF(Celin BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF(Celin BETWEEN 0 and 5,1,0)) AS 0to5,Region from demotable GROUP BY Region"
			connection.query(qs)
				.on('done', function(data) {
					var result = JSON.stringify(data, null, 2);
					generateImage(sender,data);
					//datatotable(result)
				})
				.on('fail', function(error) {
					console.error(error);
					// TODO
				});
			break;
		case "search":
		if(isDefined(parameters["ItemCategory"]) && isDefined(parameters["SalesPerson"])){
			qs="SELECT TOP 1 * FROM demotable WHERE ItemCategory='"+parameters["ItemCategory"]+"' AND Salesperson='"+parameters["SalesPerson"]+"'";
		}
		else if (isDefined(parameters["ItemCategory"]) && isDefined(parameters["Region"])) {
			qs="SELECT TOP 1 * FROM demotable WHERE ItemCategory='"+parameters["ItemCategory"]+"' AND Region='"+parameters["Region"]+"'";
		}
		else if (isDefined(parameters["ItemCategory"])) {
				qs="SELECT TOP 3 SUM(Quantity), ItemCategory, ModelNumber FROM demotable WHERE ItemCategory='"+parameters["ItemCategory"]+"' GROUP BY ModelNumber";
		}
		else {
			qs="SELECT TOP 1 * FROM demotable";
		}
		connection.query(qs)
			.on('done', function(data) {
				var result = JSON.stringify(data, null, 2);
				sendTextMessage(sender, result);
				sendQuickReply(sender,"If you want break it down by region",replies);
			})
			.on('fail', function(error) {
				console.error(error);
				// TODO 逻辑处理
			});
			break;
			case "pa":
			console.log("pa");
			if(isDefined(parameters["vaccines"])){
				qs="SELECT SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5 FROM demotable";
			}connection.query(qs)
				.on('done', function(data) {
					var result = JSON.stringify(data, null, 2);
					generateImage(sender,data);
					sendTextMessage(sender, result);
					console.log(result);
				})
				.on('fail', function(error) {
					console.error(error);
					// TODO 逻辑处理
				});
				break;
				case "filter":
				console.log("filter");
				if (isDefined(parameters["vaccines"]) && isDefined(parameters["Region"]) && isDefined(parameters["State"]) && isDefined(parameters["Month"])) {
					console.log("rsm");
					qs="SELECT SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5 FROM demotable Where Region='"+parameters["Region"]+"' AND State='"+parameters["State"]+"' AND Month='"+parameters["Month"]+"'";
				}
				if(isDefined(parameters["vaccines"]) && isDefined(parameters["State"])){
					console.log(parameters["vaccines"]);
					console.log(parameters["State"]);
					console.log("S");
					qs="SELECT State,SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5 FROM demotable Where State='"+parameters["State"]+"' GROUP BY State";
				}
				if (isDefined(parameters["vaccines"]) && isDefined(parameters["Month"])) {
					console.log(parameters["vaccines"]);
					console.log(parameters["Month"]);
					console.log("M");
										qs="SELECT SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5 FROM demotable Where Month='"+parameters["Month"]+"'";
				}
				if (isDefined(parameters["vaccines"]) && isDefined(parameters["State"]) && isDefined(parameters["Month"])) {
					console.log(parameters["vaccines"]);
					console.log(parameters["Month"]);
					console.log("SM");
					qs="SELECT SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5 FROM demotable Where State='"+parameters["State"]+"' AND Month='"+parameters["Month"]+"'";
				}
				if (isDefined(parameters["vaccines"]) && isDefined(parameters["Region"])) {
					console.log(parameters["vaccines"]);
					console.log(parameters["Region"]);
					console.log("R");
					qs="SELECT SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5 FROM demotable Where Region='"+parameters["Region"]+"'";
				}
				if (isDefined(parameters["vaccines"]) && isDefined(parameters["Region"]) && isDefined(parameters["Month"])) {
					console.log(parameters["vaccines"]);
					console.log(parameters["Region"]);
					console.log("RM");
					qs="SELECT SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5 FROM demotable Where Region='"+parameters["Region"]+"' AND Month='"+parameters["Month"]+"'";
				}
				if (isDefined(parameters["vaccines"]) && isDefined(parameters["Region"]) && isDefined(parameters["State"])) {
					console.log(parameters["vaccines"]);
					console.log(parameters["Region"]);
					console.log(parameters["State"]);
					console.log("RS");
					qs="SELECT SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5 FROM demotable Where Region='"+parameters["Region"]+"' AND State='"+parameters["State"]+"'";
				}
				if (isDefined(parameters["vaccines"]) && isDefined(parameters["Region"]) && isDefined(parameters["State"]) && isDefined(parameters["Month"])) {
					console.log("rsm");
					qs="SELECT SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5 FROM demotable Where Region='"+parameters["Region"]+"' AND State='"+parameters["State"]+"' AND Month='"+parameters["Month"]+"'";
				}
				connection.query(qs)
					.on('done', function(data) {
						var result = JSON.stringify(data, null, 2);
						sendTextMessage(sender,result);
						generateImage(sender, data);
						console.log(result);
					})
					.on('fail', function(error) {
						console.error(error);
						// TODO
					});
				break;
				case "ra":
				console.log("ra");
					if(isDefined(parameters["vaccines"]) && isDefined(parameters["all"])) {
						console.log("all");
						qs="SELECT SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5,Region FROM demotable GROUP BY Region";
					}
					else if (isDefined(parameters["vaccines"]) && isDefined(parameters["Region"])) {
						console.log("region");
						qs="SELECT SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5,Region FROM demotable WHERE Region='"+parameters["Region"]+"' GROUP BY Region";
					}
					connection.query(qs)
						.on('done', function(data) {
							var result = JSON.stringify(data, null, 2);
							sendTextMessage(sender, result);
							console.log(result);
						})
						.on('fail', function(error) {
							console.error(error);
							// TODO
						});
					break;
					case "ma":
					console.log("ma");
						if(isDefined(parameters["vaccines"]) && isDefined(parameters["Month"])){
							qs="SELECT SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5,Month FROM demotable WHERE Month='"+parameters["Month"]+"' GROUP BY Month";
						}
						connection.query(qs)
							.on('done', function(data) {
								var result = JSON.stringify(data, null, 2);
								sendTextMessage(sender, result);
								console.log(result);
							})
							.on('fail', function(error) {
								console.error(error);
								// TODO
							});
						break;
						case "group":
						console.log("group");
						if (isDefined(parameters["vaccines"]) && isDefined(parameters["Resource-name"])) {
							qs="SELECT SUM(IIF("+parameters["vaccines"]+" > 20,1,0)) AS Morethan20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 16 and 20,1,0)) AS 16to20,SUM(IIF("+parameters["vaccines"]+" BETWEEN 11 and 15,1,0)) AS 11to15,SUM(IIF("+parameters["vaccines"]+" BETWEEN 6 and 10,1,0)) AS 6to10,SUM(IIF("+parameters["vaccines"]+" BETWEEN 0 and 5,1,0)) AS 0to5,"+parameters["Resource-name"]+" FROM demotable GROUP BY "+parameters["Resource-name"]+"";
						}
						connection.query(qs)
							.on('done', function(data) {
								var result = JSON.stringify(data, null, 2);
								sendTextMessage(sender, result);
								console.log(result);
							})
							.on('fail', function(error) {
								console.error(error);
								// TODO
							});
							break;
		default:
			//unhandled action, just send back the text
	}
}

function handleMessage(message, sender) {
	switch (message.type) {
		case 0: //text
			sendTextMessage(sender, message.speech);
			break;
		case 2: //quick replies
			let replies = [];
			for (var b = 0; b < message.replies.length; b++) {
				let reply =
				{
					"content_type": "text",
					"title": message.replies[b],
					"payload": message.replies[b]
				}
				replies.push(reply);
			}
			sendQuickReply(sender, message.title, replies);
			break;
		case 3: //image
			sendImageMessage(sender, message.imageUrl);
			break;
		case 4:
			// custom payload
			var messageData = {
				recipient: {
					id: sender
				},
				message: message.payload.facebook

			};

			callSendAPI(messageData);

			break;
	}
}


function handleCardMessages(messages, sender) {

	let elements = [];
	for (var m = 0; m < messages.length; m++) {
		let message = messages[m];
		let buttons = [];
		for (var b = 0; b < message.buttons.length; b++) {
			let isLink = (message.buttons[b].postback.substring(0, 4) === 'http');
			let button;
			if (isLink) {
				button = {
					"type": "web_url",
					"title": message.buttons[b].text,
					"url": message.buttons[b].postback
				}
			} else {
				button = {
					"type": "postback",
					"title": message.buttons[b].text,
					"payload": message.buttons[b].postback
				}
			}
			buttons.push(button);
		}


		let element = {
			"title": message.title,
			"image_url":message.imageUrl,
			"subtitle": message.subtitle,
			"buttons": buttons
		};
		elements.push(element);
	}
	sendGenericMessage(sender, elements);
}


function handleApiAiResponse(sender, response) {
	let responseText = response.result.fulfillment.speech;
	let responseData = response.result.fulfillment.data;
	let messages = response.result.fulfillment.messages;
	let action = response.result.action;
	let contexts = response.result.contexts;
	let parameters = response.result.parameters;

	sendTypingOff(sender);

	if (isDefined(messages) && (messages.length == 1 && messages[0].type != 0 || messages.length > 1)) {
		let timeoutInterval = 1100;
		let previousType ;
		let cardTypes = [];
		let timeout = 0;
		for (var i = 0; i < messages.length; i++) {

			if ( previousType == 1 && (messages[i].type != 1 || i == messages.length - 1)) {

				timeout = (i - 1) * timeoutInterval;
				setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
				cardTypes = [];
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			} else if ( messages[i].type == 1 && i == messages.length - 1) {
				cardTypes.push(messages[i]);
                		timeout = (i - 1) * timeoutInterval;
                		setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
                		cardTypes = [];
			} else if ( messages[i].type == 1 ) {
				cardTypes.push(messages[i]);
			} else {
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			}

			previousType = messages[i].type;

		}
	} else if (responseText == '' && !isDefined(action)) {
		//api ai could not evaluate input.
		console.log('Unknown query' + response.result.resolvedQuery);
		sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
	} else if (isDefined(action)) {
		handleApiAiAction(sender, action, responseText, contexts, parameters);
	} else if (isDefined(responseData) && isDefined(responseData.facebook)) {
		try {
			console.log('Response as formatted message' + responseData.facebook);
			sendTextMessage(sender, responseData.facebook);
		} catch (err) {
			sendTextMessage(sender, err.message);
		}
	} else if (isDefined(responseText)) {

		sendTextMessage(sender, responseText);
	}
}

function sendToApiAi(sender, text) {

	sendTypingOn(sender);
	let apiaiRequest = apiAiService.textRequest(text, {
		sessionId: sessionIds.get(sender)
	});

	apiaiRequest.on('response', (response) => {
		if (isDefined(response.result)) {
			handleApiAiResponse(sender, response);
		}
	});

	apiaiRequest.on('error', (error) => console.error(error));
	apiaiRequest.end();
}




function sendTextMessage(recipientId, text) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text
		}
	}
	callSendAPI(messageData);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, imageUrl) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: imageUrl	}
			}
		}
	};
console.log(imageUrl);
	callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: config.SERVER_URL + "/assets/instagram_logo.gif"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "audio",
				payload: {
					url: config.SERVER_URL + "/assets/sample.mp3"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example videoName: "/assets/allofus480.mov"
 */
function sendVideoMessage(recipientId, videoName) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "video",
				payload: {
					url: config.SERVER_URL + videoName
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example fileName: fileName"/assets/test.txt"
 */
function sendFileMessage(recipientId, fileName) {
	var messageData = {
recipient: {
id: recipientId
},
message: {
attachment: {
type: "image",
payload: {
"is_reusable" : true
}
}
},
filedata: fileName+";type=image/png"
};

	callSendAPI(messageData);
}



/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId, text, buttons) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: text,
					buttons: buttons
				}
			}
		}
	};

	callSendAPI(messageData);
}


function sendGenericMessage(recipientId, elements) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "generic",
					elements: elements
				}
			}
		}
	};

	callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
							timestamp, elements, address, summary, adjustments) {
	// Generate a random receipt ID as the API requires a unique ID
	var receiptId = "order" + Math.floor(Math.random() * 1000);

	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "receipt",
					recipient_name: recipient_name,
					order_number: receiptId,
					currency: currency,
					payment_method: payment_method,
					timestamp: timestamp,
					elements: elements,
					address: address,
					summary: summary,
					adjustments: adjustments
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, text, replies, metadata) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text,
			metadata: isDefined(metadata)?metadata:'',
			quick_replies: replies
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {

	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "mark_seen"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_on"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_off"
	};

	callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: "Welcome. Link your account.",
					buttons: [{
						type: "account_link",
						url: config.SERVER_URL + "/authorize"
          }]
				}
			}
		}
	};

	callSendAPI(messageData);
}


function greetUserText(userId) {
	//first read user firstname
	request({
		uri: 'https://graph.facebook.com/v2.7/' + userId,
		qs: {
			access_token: config.FB_PAGE_TOKEN
		}

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {

			var user = JSON.parse(body);

			if (user.first_name) {
				console.log("FB user: %s %s, %s",
					user.first_name, user.last_name, user.gender);

				sendTextMessage(userId, "Welcome " + user.first_name + '!');
			} else {
				console.log("Cannot get data for fb user with id",
					userId);
			}
		} else {
			console.error(response.error);
		}

	});
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {

	console.log(messageData);
	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: {
			access_token: config.FB_PAGE_TOKEN
		},
		method: 'POST',
		json: messageData
	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var recipientId = body.recipient_id;
			var messageId = body.message_id;

			if (messageId) {
				console.log("Successfully sent message with id %s to recipient %s",
					messageId, recipientId);
			} else {
				console.log("Successfully called Send API for recipient %s",
					recipientId);
			}
		} else {
			console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
		}
	});
}



/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfPostback = event.timestamp;

	// The 'payload' param is a developer-defined field which is set in a postback
	// button for Structured Messages.
	var payload = event.postback.payload;

	switch (payload) {
		default:
			//unindentified payload
			sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
			break;

	}

	console.log("Received postback for user %d and page %d with payload '%s' " +
		"at %d", senderID, recipientID, payload, timeOfPostback);

}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	// All messages before watermark (a timestamp) or sequence have been seen.
	var watermark = event.read.watermark;
	var sequenceNumber = event.read.seq;

	console.log("Received message read event for watermark %d and sequence " +
		"number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 *
 */
function receivedAccountLink(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	var status = event.account_linking.status;
	var authCode = event.account_linking.authorization_code;

	console.log("Received account link event with for user %d with status %s " +
		"and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var delivery = event.delivery;
	var messageIDs = delivery.mids;
	var watermark = delivery.watermark;
	var sequenceNumber = delivery.seq;

	if (messageIDs) {
		messageIDs.forEach(function (messageID) {
			console.log("Received delivery confirmation for message ID: %s",
				messageID);
		});
	}

	console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfAuth = event.timestamp;

	// The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
	// The developer can set this to an arbitrary value to associate the
	// authentication callback with the 'Send to Messenger' click event. This is
	// a way to do account linking when the user clicks the 'Send to Messenger'
	// plugin.
	var passThroughParam = event.optin.ref;

	console.log("Received authentication for user %d and page %d with pass " +
		"through param '%s' at %d", senderID, recipientID, passThroughParam,
		timeOfAuth);

	// When an authentication is received, we'll send a message back to the sender
	// to let them know it was successful.
	sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
	var signature = req.headers["x-hub-signature"];

	if (!signature) {
		throw new Error('Couldn\'t validate the signature.');
	} else {
		var elements = signature.split('=');
		var method = elements[0];
		var signatureHash = elements[1];

		var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
			.update(buf)
			.digest('hex');

		if (signatureHash != expectedHash) {
			throw new Error("Couldn't validate the request signature.");
		}
	}
}

 function datatotable(data){
	 var tableify = require('tableify');
	 var html = tableify({
    Result : data
    });
		console.log(html);
		var http = require('http');var fs = require("fs");
 	http.createServer(function(request, response) {
}).listen(3000);
fs.readFile("bargraph.html", function(err, data){
  response.writeHead(200, {'Content-Type': 'text/html'});
	data="<!doctype HTML><html><head><title>Index</title></head><body>"+html+"</body></html"
  response.write(data);
  response.end();
});
	}
// 	var ctx = $("#mycanvas");
//
// 			var barGraph = new Chart(ctx, {
// 				type: 'bar',
// 				data: data
// 			});
// }

function generateImage(sender,data){
	var htmlString = "<html><head><style>body{background-color:white}  table { border-collapse: collapse; border-spacing: 0; width: 100%; border: 1px solid #ddd; } th, td { border: none; text-align: left; padding: 8px; }tr:nth-child(even){background-color: #f2f2f2}</style><body><div width='100%'><table><tr><th>NAME</th></tr>";

	if(data != undefined){

	htmlString = htmlString + "<tr>";
	for( var key in data[0]){
	htmlString = htmlString + "<th>" + key + "</th>";
	}
	for(var i = 0 ; i < data.length; i++){
	htmlString = htmlString + "<tr>";
	for(var key in data[i]){
	 htmlString = htmlString + "<td>" + data[i][key] + "</td>";
	}
	htmlString = htmlString + "</tr>";
	}
	}

	htmlString = htmlString + '</table></div></body></html>';
	console.log(htmlString);
	var options = {screenSize: {
width: 920
, height: 480
}
, shotSize: {
width: 320
, height: 'all'
}
, userAgent: 'Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_2 like Mac OS X; en-us)'
+ ' AppleWebKit/531.21.20 (KHTML, like Gecko) Mobile/7B298g'
};
	webshot(htmlString, 'hello_world.png',{siteType:'html'}, function(err) { console.log(err);

	var AWS = require('aws-sdk');

var s3 = new AWS.S3();

// Bucket names must be unique across all S3 users

var myBucket = 'qarma-pms';

var myKey = 'GSK/hello_world.png'
 var fs = require('fs');
fs.readFile('hello_world.png', function (err,data) {
  if (err) { throw err; }



  var params = {Bucket: myBucket, Key: myKey, Body: data, ACL: 'public-read', ContentType : 'image/png'};

     s3.putObject(params, function(err, data) {
         if (err) {

             console.log(err)

         } else {

             console.log("Successfully uploaded data to myBucket/myKey");
						 	sendImageMessage(sender,'https://s3-us-west-2.amazonaws.com/qarma-pms/GSK/hello_world.png');
         }
   });
});

	});
}


function isDefined(obj) {
	if (typeof obj == 'undefined' || typeof obj == '') {
		return false;
	}

	if (!obj) {
		return false;
	}

	return obj != null;
}

// Spin up the server
app.listen(app.get('port'), function () {
	console.log('running on port', app.get('port'))
})
