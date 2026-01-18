import { useState } from 'react'
// Commented out logo imports
// import reactLogo from './assets/react.svg'
// import viteLogo from '/vite.svg'
import './App.css'
import Map from './Map.jsx'


function App() {
  const [count, setCount] = useState(0)

  return (
    <Map/>
  )
}

export default App
