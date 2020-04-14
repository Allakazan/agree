let express = require('express');
let app = express();
let path = require('path');
let http = require('http').createServer(app);
let io = require('socket.io')(http);
let mustacheExpress = require('mustache-express');

const PORT = process.env.PORT || 5000

const api = require('./routes');

app.engine('html', mustacheExpress())

app.set('view engine', 'html')
app.set('views', path.resolve(__dirname+'/../views'))

//app.use('/emoji-js',express.static(path.resolve(__dirname+'/../node_modules/emoji-js/lib')));
//app.use('/emoji-data',express.static(path.resolve(__dirname+'/../node_modules/emoji-datasource')));
app.use(express.static(path.join(__dirname, '/../client/build')))

app.use('/api', api);

// Anything that doesn't match the above, send back index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname + '/../client/build/index.html'))
})

require('./socket/chat')(io);

http.listen(PORT, function(){
    console.log(`listening on *:${PORT}`);
})