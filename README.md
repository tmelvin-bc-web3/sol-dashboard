# SOL Perp Trading Dashboard

A real-time SOL/USDT perpetual trading analysis dashboard with TradingView charts and multi-indicator signal analysis.

## Features

- **Live TradingView Chart** - SOL/USDT perpetual with EMAs, Bollinger Bands, RSI, MACD
- **Signal Analysis** - Aggregated long/short bias with confidence scoring
- **Indicators** - RSI, Stochastic RSI, MACD, ADX, ATR, Bollinger Bands, VWAP, OBV
- **Category Breakdown** - Trend, Momentum, Volume, Volatility, Price Action

## Deploy to Vercel

### Option 1: One-Click Deploy (Easiest)

1. Push this folder to a GitHub repository
2. Go to [vercel.com](https://vercel.com) and sign in with GitHub
3. Click "New Project"
4. Import your repository
5. Click "Deploy" - Vercel auto-detects Vite

### Option 2: Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Navigate to project folder
cd sol-dashboard

# Deploy
vercel
```

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## Disclaimer

This is for educational purposes only. Not financial advice. Always do your own research before trading.
