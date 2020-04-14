const express = require('express');
const router = express.Router();

const rooms = require('../model/rooms');

let urlFriendly = function(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(' ','-').toLowerCase()
}

router.get('/rooms', (req, res) => {
    res.json(rooms);
});

router.get('/rooms/:room', (req, res) => {
    let id = req.params.room;
    let room = rooms.find(x => x.id == id);

    if (!room) return res.status(400).json({'message': 'No room matching ' + id});
        
    return res.json({
        id: id,
        name: room.name,
        image: urlFriendly(room.name) + '.jpg'
    })
});

module.exports = router;