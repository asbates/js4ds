const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors'); // https://github.com/rangle/hub/wiki/CORS

// Main server object and database object.
// db is provided during load.
let db = null
const app = express()
app.use(bodyParser.json())
app.use(cors())

// Get survey statistics.
app.get('/survey/stats', (req, res, next) => {
  db.getSurveyStats([], (rows, lastId) => {
    res.status(200).json(rows)
  })
})

// Get a slice of the survey data.
app.get('/survey/:start/:count', (req, res, next) => {
  const start = req.params.start
  const count = req.params.count
  db.getSurveyData([start, count], (rows, lastId) => {
    res.status(200).json(rows)
  })
})

// Nothing else worked.
app.use((req, res, next) => {
  page = `<html><body><p>error: "${req.url}" not found</p></body></html>`
  res.status(404).send(page)
})

module.exports = (databaseHandler) => {
  db = databaseHandler
  return app
}
