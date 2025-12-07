import React, { useState, useEffect, useMemo } from 'react';

// Generate realistic SOL price data for analysis
const generateMarketData = () => {
  const basePrice = 230 + Math.random() * 20;
  const data = [];
  let price = basePrice;
  let trend = Math.random() > 0.5 ? 1 : -1;
  
  for (let i = 0; i < 100; i++) {
    if (Math.random() < 0.05) trend *= -1;
    const volatility = price * 0.003;
    const change = (Math.random() - 0.5 + trend * 0.2) * volatility;
    price = Math.max(price + change, price * 0.95);
    
    data.push({
      open: price - Math.random() * volatility,
      high: price + Math.random() * volatility,
      low: price - Math.random() * volatility,
      close: price,
      volume: Math.random() * 50000 + 10000,
    });
  }
  return data;
};

const calcEMA = (data, period) => {
  const k = 2 / (period + 1);
  let ema = data[0]?.close || 0;
  return data.map((d, i) => {
    if (i === 0) return ema;
    ema = d.close * k + ema * (1 - k);
    return ema;
  });
};

const calcRSI = (data, period = 14) => {
  const changes = data.map((d, i) => i === 0 ? 0 : d.close - data[i - 1].close);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? -c : 0);
  let avgGain = gains.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  
  return data.map((_, i) => {
    if (i < period) return 50;
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    return avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  });
};

const calcStochRSI = (data, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) => {
  const rsi = calcRSI(data, rsiPeriod);
  const stochK = rsi.map((r, i) => {
    if (i < stochPeriod) return 50;
    const slice = rsi.slice(i - stochPeriod + 1, i + 1);
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    return max === min ? 50 : ((r - min) / (max - min)) * 100;
  });
  const smoothK = stochK.map((_, i) => i < kPeriod ? stochK[i] : stochK.slice(i - kPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / kPeriod);
  const smoothD = smoothK.map((_, i) => i < dPeriod ? smoothK[i] : smoothK.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / dPeriod);
  return { k: smoothK, d: smoothD };
};

const calcMACD = (data) => {
  const ema12 = calcEMA(data, 12);
  const ema26 = calcEMA(data, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalData = macdLine.map(v => ({ close: v }));
  const signal = calcEMA(signalData, 9);
  return { macd: macdLine, signal, histogram: macdLine.map((v, i) => v - signal[i]) };
};

const calcATR = (data, period = 14) => {
  const tr = data.map((d, i) => {
    if (i === 0) return d.high - d.low;
    const prev = data[i - 1];
    return Math.max(d.high - d.low, Math.abs(d.high - prev.close), Math.abs(d.low - prev.close));
  });
  return tr.map((_, i) => i < period ? tr.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1) : tr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
};

const calcADX = (data, period = 14) => {
  const tr = data.map((d, i) => {
    if (i === 0) return d.high - d.low;
    const prev = data[i - 1];
    return Math.max(d.high - d.low, Math.abs(d.high - prev.close), Math.abs(d.low - prev.close));
  });
  const plusDM = data.map((d, i) => {
    if (i === 0) return 0;
    const prev = data[i - 1];
    const upMove = d.high - prev.high;
    const downMove = prev.low - d.low;
    return upMove > downMove && upMove > 0 ? upMove : 0;
  });
  const minusDM = data.map((d, i) => {
    if (i === 0) return 0;
    const prev = data[i - 1];
    const upMove = d.high - prev.high;
    const downMove = prev.low - d.low;
    return downMove > upMove && downMove > 0 ? downMove : 0;
  });
  const smoothTR = tr.map((_, i) => i < period ? tr.slice(0, i + 1).reduce((a, b) => a + b, 0) : tr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0));
  const smoothPlusDM = plusDM.map((_, i) => i < period ? plusDM.slice(0, i + 1).reduce((a, b) => a + b, 0) : plusDM.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0));
  const smoothMinusDM = minusDM.map((_, i) => i < period ? minusDM.slice(0, i + 1).reduce((a, b) => a + b, 0) : minusDM.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0));
  const plusDI = smoothPlusDM.map((v, i) => smoothTR[i] === 0 ? 0 : (v / smoothTR[i]) * 100);
  const minusDI = smoothMinusDM.map((v, i) => smoothTR[i] === 0 ? 0 : (v / smoothTR[i]) * 100);
  const dx = plusDI.map((v, i) => { const sum = v + minusDI[i]; return sum === 0 ? 0 : (Math.abs(v - minusDI[i]) / sum) * 100; });
  const adx = dx.map((_, i) => i < period * 2 ? dx.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1) : dx.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
  return { adx, plusDI, minusDI };
};

const calcBB = (data, period = 20, mult = 2) => {
  return data.map((_, i) => {
    if (i < period - 1) return { upper: data[i].close, middle: data[i].close, lower: data[i].close, width: 0 };
    const slice = data.slice(i - period + 1, i + 1);
    const sma = slice.reduce((a, b) => a + b.close, 0) / period;
    const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b.close - sma, 2), 0) / period);
    return { upper: sma + mult * std, middle: sma, lower: sma - mult * std, width: (mult * std * 2) / sma };
  });
};

const calcVWAP = (data) => {
  let cumVolume = 0, cumVP = 0;
  return data.map(d => {
    const tp = (d.high + d.low + d.close) / 3;
    cumVolume += d.volume; cumVP += tp * d.volume;
    return cumVolume === 0 ? tp : cumVP / cumVolume;
  });
};

const calcOBV = (data) => {
  let obv = 0;
  return data.map((d, i) => {
    if (i === 0) return 0;
    if (d.close > data[i - 1].close) obv += d.volume;
    else if (d.close < data[i - 1].close) obv -= d.volume;
    return obv;
  });
};

const analyzeSignals = (data) => {
  if (data.length < 50) return { bias: 'NEUTRAL', confidence: 0, signals: [], breakdown: {}, indicators: {} };
  
  const latest = data[data.length - 1], prev = data[data.length - 2], prev5 = data[data.length - 6];
  const ema9 = calcEMA(data, 9), ema21 = calcEMA(data, 21), ema50 = calcEMA(data, 50);
  const rsi = calcRSI(data, 14), stochRSI = calcStochRSI(data);
  const { macd, signal: macdSignal, histogram } = calcMACD(data);
  const { adx, plusDI, minusDI } = calcADX(data);
  const atr = calcATR(data), bb = calcBB(data), vwap = calcVWAP(data), obv = calcOBV(data);
  
  const signals = [];
  let bullScore = 0, bearScore = 0;
  const breakdown = {
    trend: { score: 0, max: 25, signals: [] },
    momentum: { score: 0, max: 25, signals: [] },
    volume: { score: 0, max: 15, signals: [] },
    volatility: { score: 0, max: 15, signals: [] },
    priceAction: { score: 0, max: 20, signals: [] }
  };
  
  const latestEma9 = ema9[ema9.length - 1], latestEma21 = ema21[ema21.length - 1], latestEma50 = ema50[ema50.length - 1];
  const prevEma9 = ema9[ema9.length - 2], prevEma21 = ema21[ema21.length - 2];
  
  if (latestEma9 > latestEma21 && latestEma21 > latestEma50) { bullScore += 8; breakdown.trend.score += 8; breakdown.trend.signals.push({ type: 'bullish', text: 'EMAs stacked bullish' }); }
  else if (latestEma9 < latestEma21 && latestEma21 < latestEma50) { bearScore += 8; breakdown.trend.score -= 8; breakdown.trend.signals.push({ type: 'bearish', text: 'EMAs stacked bearish' }); }
  
  if (latest.close > latestEma9 && latest.close > latestEma21) { bullScore += 5; breakdown.trend.score += 5; breakdown.trend.signals.push({ type: 'bullish', text: 'Price above key EMAs' }); }
  else if (latest.close < latestEma9 && latest.close < latestEma21) { bearScore += 5; breakdown.trend.score -= 5; breakdown.trend.signals.push({ type: 'bearish', text: 'Price below key EMAs' }); }
  
  if (prevEma9 <= prevEma21 && latestEma9 > latestEma21) { bullScore += 7; breakdown.trend.score += 7; breakdown.trend.signals.push({ type: 'bullish', text: 'Golden cross (9>21 EMA)' }); }
  if (prevEma9 >= prevEma21 && latestEma9 < latestEma21) { bearScore += 7; breakdown.trend.score -= 7; breakdown.trend.signals.push({ type: 'bearish', text: 'Death cross (9<21 EMA)' }); }
  
  const latestADX = adx[adx.length - 1], latestPlusDI = plusDI[plusDI.length - 1], latestMinusDI = minusDI[minusDI.length - 1];
  if (latestADX > 25) {
    if (latestPlusDI > latestMinusDI) { bullScore += 5; breakdown.trend.score += 5; breakdown.trend.signals.push({ type: 'bullish', text: `Strong uptrend (ADX ${latestADX.toFixed(0)})` }); }
    else { bearScore += 5; breakdown.trend.score -= 5; breakdown.trend.signals.push({ type: 'bearish', text: `Strong downtrend (ADX ${latestADX.toFixed(0)})` }); }
  }
  
  const latestRSI = rsi[rsi.length - 1], latestStochK = stochRSI.k[stochRSI.k.length - 1], latestStochD = stochRSI.d[stochRSI.d.length - 1];
  const latestMACD = macd[macd.length - 1], latestMACDSignal = macdSignal[macdSignal.length - 1];
  const latestHist = histogram[histogram.length - 1], prevHist = histogram[histogram.length - 2];
  
  if (latestRSI < 30) { bullScore += 6; breakdown.momentum.score += 6; breakdown.momentum.signals.push({ type: 'bullish', text: `RSI oversold (${latestRSI.toFixed(0)})` }); }
  else if (latestRSI > 70) { bearScore += 6; breakdown.momentum.score -= 6; breakdown.momentum.signals.push({ type: 'bearish', text: `RSI overbought (${latestRSI.toFixed(0)})` }); }
  else if (latestRSI > 50) { bullScore += 2; breakdown.momentum.score += 2; breakdown.momentum.signals.push({ type: 'bullish', text: `RSI bullish (${latestRSI.toFixed(0)})` }); }
  else { bearScore += 2; breakdown.momentum.score -= 2; breakdown.momentum.signals.push({ type: 'bearish', text: `RSI bearish (${latestRSI.toFixed(0)})` }); }
  
  if (latestStochK < 20 && latestStochD < 20) { bullScore += 5; breakdown.momentum.score += 5; breakdown.momentum.signals.push({ type: 'bullish', text: 'StochRSI oversold' }); }
  else if (latestStochK > 80 && latestStochD > 80) { bearScore += 5; breakdown.momentum.score -= 5; breakdown.momentum.signals.push({ type: 'bearish', text: 'StochRSI overbought' }); }
  
  const prevStochK = stochRSI.k[stochRSI.k.length - 2], prevStochD = stochRSI.d[stochRSI.d.length - 2];
  if (prevStochK <= prevStochD && latestStochK > latestStochD && latestStochK < 50) { bullScore += 4; breakdown.momentum.score += 4; breakdown.momentum.signals.push({ type: 'bullish', text: 'StochRSI bullish cross' }); }
  if (prevStochK >= prevStochD && latestStochK < latestStochD && latestStochK > 50) { bearScore += 4; breakdown.momentum.score -= 4; breakdown.momentum.signals.push({ type: 'bearish', text: 'StochRSI bearish cross' }); }
  
  const prevMACD = macd[macd.length - 2], prevMACDSignal = macdSignal[macdSignal.length - 2];
  if (prevMACD <= prevMACDSignal && latestMACD > latestMACDSignal) { bullScore += 6; breakdown.momentum.score += 6; breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD bullish crossover' }); }
  if (prevMACD >= prevMACDSignal && latestMACD < latestMACDSignal) { bearScore += 6; breakdown.momentum.score -= 6; breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD bearish crossover' }); }
  
  if (latestHist > 0 && latestHist > prevHist) { bullScore += 4; breakdown.momentum.score += 4; breakdown.momentum.signals.push({ type: 'bullish', text: 'MACD momentum up' }); }
  else if (latestHist < 0 && latestHist < prevHist) { bearScore += 4; breakdown.momentum.score -= 4; breakdown.momentum.signals.push({ type: 'bearish', text: 'MACD momentum down' }); }
  
  const latestOBV = obv[obv.length - 1], prevOBV = obv[obv.length - 6], latestVWAP = vwap[vwap.length - 1];
  if (latestOBV > prevOBV && latest.close > prev5.close) { bullScore += 5; breakdown.volume.score += 5; breakdown.volume.signals.push({ type: 'bullish', text: 'OBV confirming up' }); }
  else if (latestOBV < prevOBV && latest.close < prev5.close) { bearScore += 5; breakdown.volume.score -= 5; breakdown.volume.signals.push({ type: 'bearish', text: 'OBV confirming down' }); }
  
  if (latest.close > latestVWAP) { bullScore += 5; breakdown.volume.score += 5; breakdown.volume.signals.push({ type: 'bullish', text: 'Above VWAP' }); }
  else { bearScore += 5; breakdown.volume.score -= 5; breakdown.volume.signals.push({ type: 'bearish', text: 'Below VWAP' }); }
  
  const avgVol = data.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
  if (latest.volume > avgVol * 1.5) {
    if (latest.close > prev.close) { bullScore += 5; breakdown.volume.score += 5; breakdown.volume.signals.push({ type: 'bullish', text: 'Volume spike (green)' }); }
    else { bearScore += 5; breakdown.volume.score -= 5; breakdown.volume.signals.push({ type: 'bearish', text: 'Volume spike (red)' }); }
  }
  
  const latestBB = bb[bb.length - 1], latestATR = atr[atr.length - 1];
  if (latestBB.width < 0.03) { breakdown.volatility.signals.push({ type: 'neutral', text: 'BB squeeze forming' }); }
  if (latest.close <= latestBB.lower) { bullScore += 5; breakdown.volatility.score += 5; breakdown.volatility.signals.push({ type: 'bullish', text: 'At lower BB' }); }
  else if (latest.close >= latestBB.upper) { bearScore += 5; breakdown.volatility.score -= 5; breakdown.volatility.signals.push({ type: 'bearish', text: 'At upper BB' }); }
  
  const recentHighs = data.slice(-10).map(d => d.high), recentLows = data.slice(-10).map(d => d.low);
  const higherHighs = recentHighs.every((h, i) => i === 0 || h >= recentHighs[i - 1] * 0.998);
  const lowerLows = recentLows.every((l, i) => i === 0 || l <= recentLows[i - 1] * 1.002);
  
  if (higherHighs && latest.close > prev.close) { bullScore += 7; breakdown.priceAction.score += 7; breakdown.priceAction.signals.push({ type: 'bullish', text: 'Higher highs' }); }
  if (lowerLows && latest.close < prev.close) { bearScore += 7; breakdown.priceAction.score -= 7; breakdown.priceAction.signals.push({ type: 'bearish', text: 'Lower lows' }); }
  
  const body = Math.abs(latest.close - latest.open);
  const upperWick = latest.high - Math.max(latest.close, latest.open);
  const lowerWick = Math.min(latest.close, latest.open) - latest.low;
  
  if (lowerWick > body * 2 && upperWick < body * 0.5 && latest.close > latest.open) { bullScore += 6; breakdown.priceAction.score += 6; breakdown.priceAction.signals.push({ type: 'bullish', text: 'Hammer candle' }); }
  if (upperWick > body * 2 && lowerWick < body * 0.5 && latest.close < latest.open) { bearScore += 6; breakdown.priceAction.score -= 6; breakdown.priceAction.signals.push({ type: 'bearish', text: 'Shooting star' }); }
  
  const totalScore = bullScore - bearScore;
  const confidence = Math.min(Math.abs(totalScore) / 100 * 100, 100);
  let bias = 'NEUTRAL';
  if (totalScore > 15) bias = 'LONG';
  else if (totalScore < -15) bias = 'SHORT';
  
  Object.values(breakdown).forEach(cat => cat.signals.forEach(s => signals.push(s)));
  
  return { bias, confidence: confidence.toFixed(0), bullScore, bearScore, totalScore, signals, breakdown,
    indicators: { rsi: latestRSI, stochK: latestStochK, stochD: latestStochD, macd: latestMACD, macdSignal: latestMACDSignal, adx: latestADX, atr: latestATR, bbWidth: latestBB.width * 100, vwap: latestVWAP, price: latest.close }
  };
};

const Badge = ({ label, value, status }) => {
  const c = { bullish: { bg: 'rgba(16,185,129,0.15)', border: '#10b981', text: '#10b981' }, bearish: { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#ef4444' }, neutral: { bg: 'rgba(100,100,100,0.15)', border: '#666', text: '#888' } }[status] || { bg: 'rgba(100,100,100,0.15)', border: '#666', text: '#888' };
  return <div style={{ background: c.bg, border: `1px solid ${c.border}`, padding: '8px 12px' }}><span style={{ fontSize: '9px', color: '#666', letterSpacing: '1px', display: 'block' }}>{label}</span><span style={{ fontSize: '14px', color: c.text, fontWeight: '500' }}>{value}</span></div>;
};

export default function Dashboard() {
  const [data, setData] = useState([]);
  const [update, setUpdate] = useState(null);
  const [funding, setFunding] = useState((Math.random() - 0.5) * 0.1);
  const [oi, setOi] = useState((Math.random() * 500 + 200).toFixed(1));
  
  useEffect(() => {
    setData(generateMarketData());
    setUpdate(new Date());
    const int = setInterval(() => {
      setData(p => {
        const n = [...p], l = n[n.length - 1], v = l.close * 0.002, c = (Math.random() - 0.48) * v;
        n.push({ open: l.close, high: l.close + Math.random() * v, low: l.close - Math.random() * v, close: l.close + c, volume: Math.random() * 50000 + 10000 });
        return n.slice(-100);
      });
      setFunding(p => p + (Math.random() - 0.5) * 0.01);
      setOi(p => (parseFloat(p) + (Math.random() - 0.5) * 10).toFixed(1));
      setUpdate(new Date());
    }, 5000);
    return () => clearInterval(int);
  }, []);
  
  const analysis = useMemo(() => analyzeSignals(data), [data]);
  const tvUrl = "https://www.tradingview.com/widgetembed/?frameElementId=tv&symbol=BINANCE%3ASOLUSDT.P&interval=5&hidesidetoolbar=0&symboledit=0&saveimage=0&toolbarbg=f1f3f6&studies=STD%3BEMA%3BSTD%3BEMA%3BSTD%3BBollinger_Bands%3BSTD%3BRSI%3BSTD%3BMACD&theme=dark&style=1&timezone=Etc%2FUTC";
  
  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#e5e5e5', fontFamily: '"IBM Plex Mono",monospace', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px', fontWeight: '700', letterSpacing: '-1px' }}>SOL PERP</span>
          <span style={{ background: '#10b981', color: '#000', padding: '2px 8px', fontSize: '10px', fontWeight: '600' }}>5M</span>
          <span style={{ background: '#3b82f6', color: '#000', padding: '2px 8px', fontSize: '10px', fontWeight: '600' }}>LIVE</span>
        </div>
        <div style={{ display: 'flex', gap: '16px', fontSize: '11px' }}>
          <div><span style={{ color: '#666' }}>FUNDING: </span><span style={{ color: funding >= 0 ? '#10b981' : '#ef4444' }}>{funding >= 0 ? '+' : ''}{(funding * 100).toFixed(4)}%</span></div>
          <div><span style={{ color: '#666' }}>OI: </span><span style={{ color: '#fff' }}>${oi}M</span></div>
        </div>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '16px', minHeight: 'calc(100vh - 120px)' }}>
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', overflow: 'hidden', minHeight: '600px' }}>
          <iframe src={tvUrl} style={{ width: '100%', height: '100%', border: 'none', minHeight: '600px' }} allowFullScreen />
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ background: analysis.bias === 'LONG' ? 'rgba(16,185,129,0.1)' : analysis.bias === 'SHORT' ? 'rgba(239,68,68,0.1)' : 'rgba(50,50,50,0.3)', border: `2px solid ${analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#444'}`, padding: '20px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#888', letterSpacing: '2px', marginBottom: '8px' }}>SIGNAL BIAS</div>
            <div style={{ fontSize: '36px', fontWeight: '700', color: analysis.bias === 'LONG' ? '#10b981' : analysis.bias === 'SHORT' ? '#ef4444' : '#666', marginBottom: '8px' }}>{analysis.bias}</div>
            <div style={{ fontSize: '12px', color: '#666' }}>Confidence: <span style={{ color: '#fff', fontWeight: '600' }}>{analysis.confidence}%</span></div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '12px', fontSize: '11px' }}>
              <span style={{ color: '#10b981' }}>▲ {analysis.bullScore}</span>
              <span style={{ color: '#ef4444' }}>▼ {analysis.bearScore}</span>
            </div>
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '12px' }}>
            <div style={{ fontSize: '10px', color: '#666', letterSpacing: '1px', marginBottom: '12px' }}>INDICATORS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <Badge label="RSI" value={analysis.indicators?.rsi?.toFixed(1) || '--'} status={analysis.indicators?.rsi < 30 ? 'bullish' : analysis.indicators?.rsi > 70 ? 'bearish' : 'neutral'} />
              <Badge label="STOCH" value={analysis.indicators?.stochK?.toFixed(1) || '--'} status={analysis.indicators?.stochK < 20 ? 'bullish' : analysis.indicators?.stochK > 80 ? 'bearish' : 'neutral'} />
              <Badge label="ADX" value={analysis.indicators?.adx?.toFixed(1) || '--'} status={analysis.indicators?.adx > 25 ? 'bullish' : 'neutral'} />
              <Badge label="ATR" value={analysis.indicators?.atr?.toFixed(3) || '--'} status="neutral" />
              <Badge label="MACD" value={analysis.indicators?.macd?.toFixed(4) || '--'} status={analysis.indicators?.macd > analysis.indicators?.macdSignal ? 'bullish' : 'bearish'} />
              <Badge label="BB%" value={`${analysis.indicators?.bbWidth?.toFixed(1) || '--'}%`} status="neutral" />
            </div>
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '12px' }}>
            <div style={{ fontSize: '10px', color: '#666', letterSpacing: '1px', marginBottom: '12px' }}>BREAKDOWN</div>
            {Object.entries(analysis.breakdown || {}).map(([k, c]) => (
              <div key={k} style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '4px' }}>
                  <span style={{ color: '#888', textTransform: 'uppercase' }}>{k}</span>
                  <span style={{ color: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#666' }}>{c.score > 0 ? '+' : ''}{c.score}</span>
                </div>
                <div style={{ height: '4px', background: '#1a1a1a', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(Math.abs(c.score) / c.max * 100, 100)}%`, background: c.score > 0 ? '#10b981' : c.score < 0 ? '#ef4444' : '#444' }} />
                </div>
              </div>
            ))}
          </div>
          
          <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', padding: '12px', flex: 1, overflow: 'auto', maxHeight: '250px' }}>
            <div style={{ fontSize: '10px', color: '#666', letterSpacing: '1px', marginBottom: '12px' }}>SIGNALS ({analysis.signals?.length || 0})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {(analysis.signals || []).slice(0, 14).map((s, i) => (
                <div key={i} style={{ fontSize: '10px', padding: '5px 8px', background: s.type === 'bullish' ? 'rgba(16,185,129,0.1)' : s.type === 'bearish' ? 'rgba(239,68,68,0.1)' : 'rgba(100,100,100,0.1)', borderLeft: `2px solid ${s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#666'}`, color: s.type === 'bullish' ? '#10b981' : s.type === 'bearish' ? '#ef4444' : '#888' }}>
                  {s.type === 'bullish' ? '▲' : s.type === 'bearish' ? '▼' : '◆'} {s.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#444' }}>
        <div>TradingView Chart • Analysis updates 5s • Not financial advice</div>
        <div>{update?.toLocaleTimeString()}</div>
      </div>
    </div>
  );
}
