const express = require('express');
const router = express.Router();

const RoomController = require('./controllers/RoomController');

router.get('/rooms', RoomController.index);

router.get('/rooms/:room', RoomController.search);

module.exports = router;