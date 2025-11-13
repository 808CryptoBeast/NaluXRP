# 🌊 NaluXrp - Riding The Ledger Waves

A comprehensive, real-time analytics dashboard for the XRP Ledger (XRPL). Monitor network activity, explore tokens, analyze AMM pools, discover NFTs, and track validators—all in one beautiful, responsive interface.

![NaluXrp Dashboard](assets/logo.png)

## ✨ Features

### 📊 **Live Dashboard**
- Real-time XRPL network metrics
- Transaction per second (TPS) monitoring
- Ledger index tracking
- Average fee analysis
- Validator statistics
- Live sparkline charts

### 💧 **AMM Pools**
- Automated Market Maker pool explorer
- Liquidity tracking
- Trading pair analysis
- Pool performance metrics

### 🪙 **Token Explorer**
- XRPL token discovery
- Token metrics and analytics
- Trust line information
- Market data visualization

### 🎨 **NFT Browser**
- XRP Ledger NFT explorer
- Metadata viewing
- Collection browsing
- Advanced filtering

### 🛡️ **Validator Monitor**
- Network validator tracking
- Validator performance metrics
- Consensus monitoring
- Network health indicators

### 🎨 **Theme System**
- 4 beautiful themes: Gold, Cosmic, Starry, Hawaiian
- Smooth theme transitions
- Dynamic background effects
- Responsive design

## 🚀 Quick Start

### Prerequisites
- A modern web browser (Chrome, Firefox, Safari, Edge)
- Web server (for local development) or direct file access

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/naluxrp.git
   cd naluxrp
   ```

2. **Open in browser**
   - **Option 1:** Open `index.html` directly in your browser
   - **Option 2:** Use a local server:
     ```bash
     # Python 3
     python -m http.server 8000
     
     # Node.js (with http-server)
     npx http-server
     ```
   - Navigate to `http://localhost:8000`

3. **Start exploring!**
   - The dashboard will automatically connect to the XRP Ledger mainnet
   - Navigate through different sections using the top navbar
   - Switch themes from the "More" dropdown

## 📁 Project Structure

```
naluxrp/
├── index.html              # Main HTML file
├── css/
│   └── style.css          # Complete styling system
├── js/
│   ├── utils.js           # Utility functions
│   ├── ui.js              # UI and navigation logic
│   ├── xrpl-connection.js # XRPL client connection
│   ├── dashboard.js       # Dashboard metrics & charts
│   ├── validators.js      # Validator monitoring
│   ├── tokens.js          # Token explorer
│   ├── amm.js             # AMM pool analytics
│   ├── analytics.js       # Advanced analytics
│   ├── explorer.js        # Transaction explorer
│   ├── nfts.js            # NFT browser
│   ├── profile.js         # User profile
│   ├── news.js            # XRPL news feed
│   ├── history.js         # Historical data
│   ├── settings.js        # App settings
│   └── about.js           # About page
└── assets/
    └── logo.png           # Project logo
```

## 🛠️ Technology Stack

- **Frontend:** Pure HTML5, CSS3, JavaScript (ES6+)
- **Charts:** Chart.js
- **XRPL Integration:** xrpl.js library
- **Styling:** Custom CSS with CSS Variables
- **Design:** Responsive, mobile-first approach

## 🎯 Key Features in Detail

### Real-Time Updates
- Live connection to XRPL mainnet
- Automatic data refresh every 3 seconds
- WebSocket-based event streaming
- Graceful fallback to simulated data

### Responsive Design
- Mobile-first approach
- Works on all screen sizes
- Touch-friendly interface
- Hamburger menu for mobile

### Visual Analytics
- Interactive sparkline charts
- Bar charts for transaction distribution
- Real-time data visualization
- Color-coded metrics

### Network Monitoring
- Ledger close time tracking
- Queue depth monitoring
- Validator consensus tracking
- Transaction type distribution

## 🎨 Themes

Choose from 4 stunning themes:

1. **Gold** - Classic elegance with golden accents
2. **Cosmic** - Purple nebula with space vibes
3. **Starry** - Deep blue with twinkling stars
4. **Hawaiian** - Tropical ocean gradient

Switch themes anytime from the navbar's "More" menu!

## 🌐 Browser Support

- ✅ Chrome/Edge (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## 📝 Development

### Adding New Features

1. Create a new JS module in the `js/` folder
2. Add the corresponding section in `index.html`
3. Include the script tag in the proper load order
4. Register the page in `ui.js` navigation system

### Customizing Themes

Edit CSS variables in `style.css`:

```css
body.theme-custom {
  --bg-primary: #your-color;
  --accent-primary: #your-color;
  /* ... more variables */
}
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [XRPL.js](https://js.xrpl.org/) - XRP Ledger JavaScript library
- [Chart.js](https://www.chartjs.org/) - Beautiful charts
- [XRPL Foundation](https://xrpl.org/) - XRP Ledger documentation
- Hawaiian surf culture for the "Nalu" inspiration 🏄‍♂️

## 📧 Contact

Project Link: [https://github.com/yourusername/naluxrp](https://github.com/yourusername/naluxrp)

## 🌊 What does "Nalu" mean?

"Nalu" is the Hawaiian word for "wave" or "surf". Just as surfers ride ocean waves, NaluXrp helps you ride the waves of the XRP Ledger! 🏄‍♂️

---

**Made with 💙 for the XRPL community**

*Ride the ledger waves!* 🌊
