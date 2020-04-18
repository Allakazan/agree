const express = require('express');
const router = express.Router();

const RoomController = require('./controllers/RoomController');
const SessionController = require('./controllers/SessionController');
const MediaController = require('./controllers/MediaController');

router.get('/auth', SessionController.index);
router.post('/auth', SessionController.create);

router.get('/media/:id', MediaController.index);

router.get('/rooms', RoomController.index);
router.get('/rooms/:room', RoomController.search);

module.exports = router;