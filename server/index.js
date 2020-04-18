let express = require('express');
let app = express();
let path = require('path');
let http = require('http').createServer(app);
let io = require('socket.io')(http);
require('dotenv-safe').config();

const PORT = process.env.PORT || 5000

const api = require('./routes');

app.use(express.json());
//app.use('/emoji-js',express.static(path.resolve(__dirname+'/../node_modules/emoji-js/lib')));
//app.use('/emoji-data',express.static(path.resolve(__dirname+'/../node_modules/emoji-datasource')));
app.use('/api', api);
app.use('/avatar', express.static(path.join(__dirname, '/storage/avatar')));

app.use(express.static(path.join(__dirname, '/../client/build')))
// Anything that doesn't match the above, send back index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname + '/../client/build/index.html'))
})

require('./socket/chat')(io);

http.listen(PORT, function(){
    console.log(`listening on *:${PORT}`);
})