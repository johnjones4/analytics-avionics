const net = require('net');
const config = require('./config');

const client = new net.Socket();
client.connect(config.socketPort,'127.0.0.1',function() {
	console.log('Connected');
});

client.on('data',function(data) {
	console.log('Received: ' + data);
});

client.on('close',function() {
	console.log('Connection closed');
});
