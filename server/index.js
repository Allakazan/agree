let express = require('express');
let app = express();
let path = require('path');
let http = require('http').createServer(app);
let io = require('socket.io')(http);
let mustacheExpress = require('mustache-express');

const PORT = process.env.PORT || 3000

const api = require('./routes/api');
const web = require('./routes/web');

app.engine('html', mustacheExpress())

app.set('view engine', 'html')
app.set('views', path.resolve(__dirname+'/../views'))

app.use(express.static(path.resolve(__dirname+'/../public')));
app.use('/emoji-js',express.static(path.resolve(__dirname+'/../node_modules/emoji-js/lib')));
app.use('/emoji-data',express.static(path.resolve(__dirname+'/../node_modules/emoji-datasource')));

app.use('/api', api);
app.use('/', web);

require('./socket/chat')(io);

http.listen(PORT, function(){
    console.log(`listening on *:${PORT}`);
})