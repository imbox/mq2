'use strict'
const Mq = require('./lib/mq')
const Message = require('./lib/message')
const Request = require('./lib/request')
const errors = require('./lib/errors')

module.exports = Mq
module.exports.Mq = Mq
module.exports.Message = Message
module.exports.Request = Request
module.exports.errors = errors
