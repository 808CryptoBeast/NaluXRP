const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// Enable CORS for all routes
app.use(cors());

// Route to fetch validators
app.get('/validators', async (req, res) => {
  try {
    console.log('📡 Proxying request to XRPL API...');
    const response = await fetch('https://api.xrpl.org/v2/network/validators?limit=200');
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`✅ Proxied ${data.validators?.length || 0} validators`);
    
    res.json(data);
  } catch (error) {
    console.error('❌ Proxy error:', error);
    res.status(500).json({ 
      error: error.message,
      message: 'Failed to fetch validators via proxy'
    });
  }
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'XRPL Validator Proxy Server',
    endpoints: {
      validators: '/validators'
    }
  });
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ Proxy server running on http://localhost:${PORT}`);
  console.log(`🌐 Endpoint: http://localhost:${PORT}/validators`);
});