import app from './app'

const PORT = parseInt(process.env.PORT || '3000', 10)

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
})
