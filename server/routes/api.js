const express = require('express');
const router = express.Router();

const rooms = require('../model/rooms');

router.get('/', (req, res) => {
    res.set('Content-Type', 'application/json');
    res.json({'api': 'works'});
});

router.get('/rooms', (req, res) => {
    res.set('Content-Type', 'application/json');
    res.json(rooms);
});

module.exports = router;