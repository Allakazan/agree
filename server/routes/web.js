const express = require('express');
const router = express.Router();

const rooms = require('../model/rooms');

let findRoom = function (room, callback) {
    if (!rooms[room])
        return callback(new Error('No room matching ' + room));

    return callback(null, rooms[room]);
};

router.get('/', function(req, res) {
    res.render('index')
});

router.get('/chat/:room', function(req, res, next) {
    let room = req.params.room;

    findRoom(room, function(error, roomObj) {
        if (error) return next(error);
        return res.render('chat', {room: {id: room, data: roomObj}})
    });
});

/*router.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist/index.html'));
});*/

module.exports = router;