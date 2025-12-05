/* =========================================
   NaluXrp 🌊 – Deep Intelligence Analytics
   Account behavior, risk scoring, clusters,
   bursts, flow patterns & interaction graph.
   ========================================= */

(function () {
  const MAX_HISTORY_POINTS = 120;
  const MAX_TX_WINDOW = 400;
  const MIN_RENDER_INTERVAL_MS = 1800;

  const DeepAnalytics = {
    initialized: false,
    ledgerHistory: [],
    txWindow: [],
    anomalies: [],
    patterns: [],
    accountProfiles: [],
    clusters: [],
    bursts: [],
    lastState: null,
    lastRender: 0,
    ledgerListener: null,
  };

  /* ---------- Helpers ---------- */

  function qs(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = qs(id);
    if (el) el.textContent = value;
  }

  function safeNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function percent(num, den) {
    const d = safeNumber(den, 0);
    if (!d) return 0;
    return (safeNumber(num, 0) / d) * 100;
  }

  function nowTs() {
    return Date.now();
  }

  function getCssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.body).getPropertyValue(name).trim();
      return v || fallback;
    } catch {
      return fallback;
    }
  }

  function pearsonCorrelation(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return null;
    }
    const pairs = [];
    for (let i = 0; i < a.length; i += 1) {
      const x = Number(a[i]);
      const y = Number(b[i]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        pairs.push([x, y]);
      }
    }
    if (pairs.length < 10) return null;

    const n = pairs.length;
    let sumX = 0;
    let sumY = 0;
    let sumX2 = 0;
    let sumY2 = 0;
    let sumXY = 0;

    for (let i = 0; i < n; i += 1) {
      const x = pairs[i][0];
      const y = pairs[i][1];
      sumX += x;
      sumY += y;
      sumX2 += x * x;
      sumY2 += y * y;
      sumXY += x * y;
    }

    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt(
      (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY),
    );
    if (!den || !Number.isFinite(den)) return null;
    const r = num / den;
    if (!Number.isFinite(r)) return null;
    return Math.max(-1, Math.min(1, r));
  }

  function describeCorrelation(r) {
    if (r === null || !Number.isFinite(r)) return "insufficient data";
    const abs = Math.abs(r);
    let strength;
    if (abs < 0.2) strength = "very weak";
    else if (abs < 0.4) strength = "weak";
    else if (abs < 0.6) strength = "moderate";
    else if (abs < 0.8) strength = "strong";
    else strength = "very strong";

    const direction = r > 0 ? "positive" : r < 0 ? "negative" : "neutral";
    return strength + " " + direction + " (r=" + r.toFixed(2) + ")";
  }

  function computeMetricAnomaly(series, label) {
    if (!Array.isArray(series) || series.length < 18) return null;
    const values = series.map(function (v) {
      return safeNumber(v, 0);
    });
    if (values.length < 18) return null;

    const latest = values[values.length - 1];
    const sample = values.slice(0, values.length - 1);
    const n = sample.length;

    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += sample[i];
    const mean = sum / n;

    let varSum = 0;
    for (let i = 0; i < n; i += 1) {
      const diff = sample[i] - mean;
      varSum += diff * diff;
    }
    const variance = varSum / n;
    const std = Math.sqrt(variance);
    if (!std || !Number.isFinite(std) || std === 0) return null;

    const z = (latest - mean) / std;
    const absZ = Math.abs(z);
    if (absZ < 2.7) return null;

    return {
      metric: label,
      value: latest,
      mean: mean,
      zScore: z,
      direction: z > 0 ? "above" : "below",
      at: new Date(),
    };
  }

  function pushAnomaly(anomaly) {
    if (!anomaly) return;
    DeepAnalytics.anomalies.unshift(anomaly);
    if (DeepAnalytics.anomalies.length > 15) {
      DeepAnalytics.anomalies.length = 15;
    }
  }

  /* ---------- Ledger -> snapshot ---------- */

  function mapLedgerStateToSnapshot(state) {
    if (!state) return null;

    const txTypes = state.txTypes || state.transactionTypes || {};
    const totalTx = Object.values(txTypes).reduce(function (sum, v) {
      return sum + safeNumber(v, 0);
    }, 0);

    const payment = safeNumber(txTypes.Payment, 0);
    const offer =
      safeNumber(txTypes.Offer, 0) +
      safeNumber(txTypes.OfferCreate, 0) +
      safeNumber(txTypes.OfferCancel, 0);
    const nft =
      safeNumber(txTypes.NFT, 0) +
      safeNumber(txTypes.NFTMint, 0) +
      safeNumber(txTypes.NFTokenMint, 0) +
      safeNumber(txTypes.NFTokenBurn, 0);
    const trust = safeNumber(txTypes.TrustSet, 0);
    const other = safeNumber(txTypes.Other, 0);

    const closeTimes = Array.isArray(state.closeTimes)
      ? state.closeTimes
      : [];
    const lastClose = closeTimes.length
      ? safeNumber(closeTimes[closeTimes.length - 1].value, 0)
      : null;

    const amm = state.amm || {};
    const trustlines = state.trustlines || {};
    const whalesArr = Array.isArray(state.whales) ? state.whales : [];

    return {
      ts: nowTs(),
      ledgerIndex: safeNumber(state.ledgerIndex, 0),
      tps: safeNumber(state.tps != null ? state.tps : state.txnPerSec, 0),
      avgFee: safeNumber(state.avgFee != null ? state.avgFee : state.feeAvg, 0),
      load: safeNumber(
        state.loadFactor != null ? state.loadFactor : state.loadFee,
        0,
      ),
      intervalSec: lastClose !== null ? lastClose : null,
      txPerLedger: safeNumber(
        state.txPerLedger != null ? state.txPerLedger : state.txnPerLedger,
        0,
      ),

      payment: payment,
      offer: offer,
      nft: nft,
      trust: trust,
      other: other,
      totalTx: totalTx,

      ammVolume: safeNumber(amm.volume24h, 0),
      ammPools: safeNumber(amm.pools, 0),
      newTrust: safeNumber(trustlines.new24h, 0),
      removedTrust: safeNumber(trustlines.removed24h, 0),
      whaleCount: whalesArr.length,
    };
  }

  function addLedgerSnapshot(state) {
    const snap = mapLedgerStateToSnapshot(state);
    if (!snap) return;

    DeepAnalytics.ledgerHistory.push(snap);
    if (DeepAnalytics.ledgerHistory.length > MAX_HISTORY_POINTS) {
      DeepAnalytics.ledgerHistory.splice(
        0,
        DeepAnalytics.ledgerHistory.length - MAX_HISTORY_POINTS,
      );
    }

    const tpsSeries = DeepAnalytics.ledgerHistory.map(function (p) {
      return p.tps;
    });
    const feeSeries = DeepAnalytics.ledgerHistory.map(function (p) {
      return p.avgFee;
    });
    const intervalSeries = DeepAnalytics.ledgerHistory
      .map(function (p) {
        return p.intervalSec;
      })
      .filter(function (v) {
        return v !== null;
      });
    const loadSeries = DeepAnalytics.ledgerHistory.map(function (p) {
      return p.load;
    });
    const payShareSeries = DeepAnalytics.ledgerHistory.map(function (p) {
      return percent(p.payment, p.totalTx || 1);
    });
    const offerShareSeries = DeepAnalytics.ledgerHistory.map(function (p) {
      return percent(p.offer, p.totalTx || 1);
    });
    const nftShareSeries = DeepAnalytics.ledgerHistory.map(function (p) {
      return percent(p.nft, p.totalTx || 1);
    });
    const whaleSeries = DeepAnalytics.ledgerHistory.map(function (p) {
      return p.whaleCount;
    });

    pushAnomaly(computeMetricAnomaly(tpsSeries, "TPS"));
    pushAnomaly(computeMetricAnomaly(feeSeries, "Avg Fee"));
    pushAnomaly(computeMetricAnomaly(intervalSeries, "Ledger Interval"));
    pushAnomaly(computeMetricAnomaly(loadSeries, "Network Load"));
    pushAnomaly(computeMetricAnomaly(payShareSeries, "Payment Share"));
    pushAnomaly(computeMetricAnomaly(offerShareSeries, "Offer Share"));
    pushAnomaly(computeMetricAnomaly(nftShareSeries, "NFT Share"));
    pushAnomaly(computeMetricAnomaly(whaleSeries, "Whale Count"));
  }

  /* ---------- Raw transaction handling ---------- */

  function normalizeTxEntry(entry) {
    if (!entry || typeof entry !== "object") return null;

    let tx = null;
    let meta = null;

    if (entry.tx_json && typeof entry.tx_json === "object") {
      tx = entry.tx_json;
      meta = entry.meta || entry.metaData || null;
    } else if (entry.tx && typeof entry.tx === "object") {
      tx = entry.tx;
      meta = entry.meta || entry.metaData || null;
    } else if (entry.transaction && typeof entry.transaction === "object") {
      tx = entry.transaction;
      meta = entry.meta || entry.metaData || null;
    } else if (entry.TransactionType) {
      tx = entry;
      meta = entry.meta || entry.metaData || null;
    } else if (entry.type && entry.account) {
      // already simplified
      return entry;
    }

    if (!tx || !tx.TransactionType) return null;

    const isSuccess =
      meta && typeof meta.TransactionResult === "string"
        ? meta.TransactionResult.indexOf("tes") === 0
        : true;

    const hash = tx.hash || entry.hash || null;

    return {
      hash: hash,
      type: tx.TransactionType,
      account: tx.Account,
      destination: tx.Destination,
      amount: tx.Amount,
      fee: tx.Fee,
      time: entry.closeTime
        ? new Date(entry.closeTime)
        : entry.date
        ? new Date(entry.date * 1000)
        : new Date(),
      success: isSuccess,
    };
  }

  function updateTxWindowFromState(state) {
    const incoming = Array.isArray(state && state.recentTransactions)
      ? state.recentTransactions
      : [];

    if (!incoming.length) return;

    const map = DeepAnalytics.txWindow;
    const seen = new Set(
      map
        .map(function (t) {
          return t.hash;
        })
        .filter(Boolean),
    );

    for (let i = 0; i < incoming.length; i += 1) {
      const norm = normalizeTxEntry(incoming[i]);
      if (!norm) continue;
      if (norm.hash && seen.has(norm.hash)) continue;
      if (norm.hash) seen.add(norm.hash);
      map.push(norm);
    }

    if (map.length > MAX_TX_WINDOW) {
      map.splice(0, map.length - MAX_TX_WINDOW);
    }
  }

  /* ---------- Amount helper ---------- */

  function parseXrpAmount(amount) {
    if (amount == null) return 0;
    if (typeof amount === "string") {
      const drops = Number(amount);
      if (!Number.isFinite(drops)) return 0;
      return drops / 1_000_000;
    }
    if (typeof amount === "object" && amount.value != null) {
      const v = Number(amount.value);
      return Number.isFinite(v) ? v : 0;
    }
    return 0;
  }

  /* ---------- Account profiles + risk scoring ---------- */

  function buildAccountProfiles() {
    const txs = DeepAnalytics.txWindow;
    const map = new Map();

    const amountBuckets = new Map(); // "A|B|Amount" → count
    const pairCounts = new Map(); // "A|B" → count

    for (let i = 0; i < txs.length; i += 1) {
      const tx = txs[i];
      if (!tx || !tx.account) continue;

      const t = tx.type;
      const from = tx.account;
      const to = tx.destination;
      const amt = parseXrpAmount(tx.amount);
      const ok = !!tx.success;

      if (!map.has(from)) {
        map.set(from, {
          account: from,
          sentCount: 0,
          recvCount: 0,
          sentVolume: 0,
          recvVolume: 0,
          paymentCount: 0,
          offerCount: 0,
          offerCancelCount: 0,
          nftCount: 0,
          trustCount: 0,
          successCount: 0,
          failCount: 0,
          lastTime: null,
          destinations: new Set(),
          sources: new Set(),
          amounts: [],
          types: new Set(),
        });
      }
      const fromStats = map.get(from);

      fromStats.sentCount += 1;
      fromStats.sentVolume += amt;
      fromStats.amounts.push(amt);
      fromStats.types.add(t);
      if (ok) fromStats.successCount += 1;
      else fromStats.failCount += 1;
      fromStats.lastTime = tx.time;
      if (to) fromStats.destinations.add(to);

      if (to) {
        if (!map.has(to)) {
          map.set(to, {
            account: to,
            sentCount: 0,
            recvCount: 0,
            sentVolume: 0,
            recvVolume: 0,
            paymentCount: 0,
            offerCount: 0,
            offerCancelCount: 0,
            nftCount: 0,
            trustCount: 0,
            successCount: 0,
            failCount: 0,
            lastTime: null,
            destinations: new Set(),
            sources: new Set(),
            amounts: [],
            types: new Set(),
          });
        }
        const toStats = map.get(to);
        toStats.recvCount += 1;
        toStats.recvVolume += amt;
        toStats.amounts.push(amt);
        toStats.types.add(t);
        if (ok) toStats.successCount += 1;
        else toStats.failCount += 1;
        toStats.lastTime = tx.time;
        toStats.sources.add(from);
      }

      if (t === "Payment") {
        fromStats.paymentCount += 1;
      } else if (t === "OfferCreate") {
        fromStats.offerCount += 1;
      } else if (t === "OfferCancel") {
        fromStats.offerCancelCount += 1;
      } else if (t === "TrustSet") {
        fromStats.trustCount += 1;
      } else if (
        typeof t === "string" &&
        (t.indexOf("NFToken") === 0 || t.indexOf("NFT") === 0)
      ) {
        fromStats.nftCount += 1;
      }

      if (from && to) {
        const pairKey = from + "|" + to;
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);

        const bucketKey = from + "|" + to + "|" + amt.toFixed(6);
        amountBuckets.set(bucketKey, (amountBuckets.get(bucketKey) || 0) + 1);
      }
    }

    const profiles = [];

    for (const [account, s] of map.entries()) {
      const totalTx = s.sentCount + s.recvCount;
      if (!totalTx) continue;

      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < s.amounts.length; i += 1) {
        const v = s.amounts[i];
        sum += v;
        sumSq += v * v;
      }
      const n = s.amounts.length || 1;
      const meanAmt = sum / n;
      const variance = n > 1 ? sumSq / n - meanAmt * meanAmt : 0;
      const stdAmt = Math.sqrt(Math.max(variance, 0));

      const outDeg = s.destinations.size;
      const inDeg = s.sources.size;
      const sendRecvRatio =
        s.recvVolume === 0
          ? s.sentVolume > 0
            ? Infinity
            : 1
          : s.sentVolume / s.recvVolume;

      let sameAmountRepeats = 0;
      amountBuckets.forEach(function (cnt, key) {
        if (key.indexOf(account + "|") !== 0) return;
        if (cnt >= 3) {
          sameAmountRepeats += cnt;
        }
      });

      let pingPongIntensity = 0;
      pairCounts.forEach(function (cnt, key) {
        const parts = key.split("|");
        const a = parts[0];
        const b = parts[1];
        if (a !== account) return;
        const reverse = b + "|" + a;
        const revCnt = pairCounts.get(reverse) || 0;
        if (revCnt > 0) {
          pingPongIntensity += cnt + revCnt;
        }
      });

      let classification = "Neutral";
      const reasons = [];
      const riskSignals = [];
      let riskScore = 0;

      const now = Date.now();
      const lastMs = s.lastTime ? now - s.lastTime.getTime() : null;

      const isWhale =
        s.sentVolume > 200000 || s.recvVolume > 200000 || meanAmt > 5000;
      const isVeryActive = totalTx >= 20;

      if (isWhale && s.recvVolume > s.sentVolume * 2 && inDeg > outDeg) {
        classification = "Whale Accumulator";
        reasons.push("receives significantly more volume than it sends");
        riskScore += 18;
        riskSignals.push("whale accumulation");
      }

      if (
        isWhale &&
        s.sentVolume > s.recvVolume * 2 &&
        outDeg >= 4 &&
        s.sentCount >= 10
      ) {
        classification = "Whale Distributor";
        reasons.push("sends large volume to many distinct destinations");
        riskScore += 18;
        riskSignals.push("whale distribution");
      }

      if (pingPongIntensity >= 12 && sameAmountRepeats >= 6) {
        classification = "Ping-Pong / Wash-like";
        reasons.push("repeated back-and-forth transfers with similar amounts");
        riskScore += 35;
        riskSignals.push("wash-like ping-pong");
      }

      if (s.offerCount + s.offerCancelCount >= 24) {
        const ratio =
          s.offerCount === 0
            ? Infinity
            : s.offerCancelCount / s.offerCount;
        if (ratio >= 1.2) {
          classification = "Orderbook Spoof-like";
          reasons.push("many offers with aggressive cancellation ratio");
          riskScore += 30;
          riskSignals.push("spoof-like orderbook activity");
        }
      }

      const smallPayments = s.paymentCount >= 8 && meanAmt < 5 && stdAmt < 10;
      if (smallPayments && s.trustCount >= 4) {
        classification = "Airdrop / Farming-like";
        reasons.push("many small payments with trustline changes");
        riskScore += 22;
        riskSignals.push("airdrop/farming-like activity");
      }

      if (
        isVeryActive &&
        !isFinite(sendRecvRatio) &&
        s.sentVolume > 0 &&
        s.recvVolume === 0 &&
        outDeg >= 10
      ) {
        classification = "Bridge / Router-like";
        reasons.push("only sends, never receives, across many recipients");
        riskScore += 20;
        riskSignals.push("router-style behavior");
      }

      if (isVeryActive && lastMs != null && lastMs < 2 * 60_000) {
        riskScore += 15;
        riskSignals.push("recent high-frequency activity");
      }

      if (sameAmountRepeats >= 8) {
        riskScore += 10;
        riskSignals.push("strong fixed-amount pattern");
      }

      if (pingPongIntensity >= 20) {
        riskScore += 10;
        riskSignals.push("strong reciprocal flow");
      }

      if (classification === "Neutral" && isVeryActive && lastMs < 5 * 60_000) {
        classification = "High-Activity Account";
        reasons.push("sustained recent throughput");
        riskScore += 8;
        riskSignals.push("general high activity");
      }

      if (riskScore > 100) riskScore = 100;
      if (riskScore < 0) riskScore = 0;

      profiles.push({
        account: account,
        classification: classification,
        reasons: reasons,
        riskScore: riskScore,
        riskSignals: riskSignals,
        totalTx: totalTx,
        sentVolume: s.sentVolume,
        recvVolume: s.recvVolume,
        meanAmt: meanAmt,
        stdAmt: stdAmt,
        outDeg: outDeg,
        inDeg: inDeg,
        paymentCount: s.paymentCount,
        offerCount: s.offerCount,
        offerCancelCount: s.offerCancelCount,
        trustCount: s.trustCount,
        nftCount: s.nftCount,
        lastTime: s.lastTime,
      });
    }

    profiles.sort(function (a, b) {
      const scoreA =
        (a.totalTx || 0) +
        (a.sentVolume + a.recvVolume) / 1000 +
        a.riskScore;
      const scoreB =
        (b.totalTx || 0) +
        (b.sentVolume + b.recvVolume) / 1000 +
        b.riskScore;
      return scoreB - scoreA;
    });

    DeepAnalytics.accountProfiles = profiles.slice(0, 12);
  }

  /* ---------- Flow genome patterns (fan-in/out, rings, corridors) ---------- */

  function detectFlowGenome() {
    const txs = DeepAnalytics.txWindow;
    const pairCounts = new Map();
    const outEdges = new Map();
    const inEdges = new Map();

    for (let i = 0; i < txs.length; i += 1) {
      const tx = txs[i];
      if (!tx || tx.type !== "Payment") continue;
      const from = tx.account;
      const to = tx.destination;
      if (!from || !to) continue;

      const key = from + "|" + to;
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);

      if (!outEdges.has(from)) outEdges.set(from, new Set());
      outEdges.get(from).add(to);

      if (!inEdges.has(to)) inEdges.set(to, new Set());
      inEdges.get(to).add(from);
    }

    const patterns = [];

    const fanOut = [];
    outEdges.forEach(function (set, node) {
      if (set.size >= 6) {
        fanOut.push({ node: node, degree: set.size });
      }
    });
    fanOut.sort(function (a, b) {
      return b.degree - a.degree;
    });
    if (fanOut.length) {
      patterns.push({
        kind: "Fan-out hubs",
        detail: fanOut.slice(0, 4),
      });
    }

    const fanIn = [];
    inEdges.forEach(function (set, node) {
      if (set.size >= 6) {
        fanIn.push({ node: node, degree: set.size });
      }
    });
    fanIn.sort(function (a, b) {
      return b.degree - a.degree;
    });
    if (fanIn.length) {
      patterns.push({
        kind: "Fan-in aggregators",
        detail: fanIn.slice(0, 4),
      });
    }

    const seenRings = new Set();
    const rings = [];

    pairCounts.forEach(function (cnt1, key1) {
      const parts = key1.split("|");
      const a = parts[0];
      const b = parts[1];
      const backKey = b + "|" + a;
      const cnt2 = pairCounts.get(backKey) || 0;
      if (cnt1 + cnt2 >= 4) {
        const id = [a, b].sort().join("↔");
        if (!seenRings.has(id)) {
          seenRings.add(id);
          rings.push({ path: a + " ↔ " + b, count: cnt1 + cnt2 });
        }
      }
    });

    if (rings.length) {
      rings.sort(function (a, b) {
        return b.count - a.count;
      });
      patterns.push({
        kind: "Ping-pong rings",
        detail: rings.slice(0, 5),
      });
    }

    const corridors = [];
    const outArr = new Map();
    pairCounts.forEach(function (count, key) {
      const parts = key.split("|");
      const from = parts[0];
      const to = parts[1];
      if (!outArr.has(from)) outArr.set(from, []);
      outArr.get(from).push({ to: to, count: count });
    });

    pairCounts.forEach(function (count, key) {
      const parts = key.split("|");
      const from = parts[0];
      const mid = parts[1];
      const nextEdges = outArr.get(mid) || [];
      for (let i = 0; i < nextEdges.length; i += 1) {
        const edge = nextEdges[i];
        const to = edge.to;
        if (to === from) continue;
        const hits = Math.min(count, edge.count);
        if (hits >= 3) {
          corridors.push({
            path: from + " → " + mid + " → " + to,
            hits: hits,
          });
        }
      }
    });

    if (corridors.length) {
      corridors.sort(function (a, b) {
        return b.hits - a.hits;
      });
      const dedup = [];
      const seen = new Set();
      for (let i = 0; i < corridors.length; i += 1) {
        const c = corridors[i];
        if (dedup.length >= 6) break;
        if (seen.has(c.path)) continue;
        seen.add(c.path);
        dedup.push(c);
      }
      if (dedup.length) {
        patterns.push({
          kind: "Corridor-like 3-hop paths",
          detail: dedup,
        });
      }
    }

    DeepAnalytics.patterns = patterns;
  }

  /* ---------- Cluster detection (connected components) ---------- */

  function detectClusters() {
    const txs = DeepAnalytics.txWindow;
    const graph = new Map(); // node -> Set(neighbors)
    const volumeMap = new Map(); // "A|B" -> volume
    const edgeCounts = new Map(); // "A|B" -> count

    for (let i = 0; i < txs.length; i += 1) {
      const tx = txs[i];
      if (!tx || tx.type !== "Payment") continue;
      const from = tx.account;
      const to = tx.destination;
      if (!from || !to) continue;

      if (!graph.has(from)) graph.set(from, new Set());
      if (!graph.has(to)) graph.set(to, new Set());
      graph.get(from).add(to);
      graph.get(to).add(from);

      const amt = parseXrpAmount(tx.amount);
      const key1 = from + "|" + to;
      const key2 = to + "|" + from;

      edgeCounts.set(key1, (edgeCounts.get(key1) || 0) + 1);
      edgeCounts.set(key2, (edgeCounts.get(key2) || 0) + 1);

      volumeMap.set(key1, (volumeMap.get(key1) || 0) + amt);
      volumeMap.set(key2, (volumeMap.get(key2) || 0) + amt);
    }

    const visited = new Set();
    const clusters = [];

    graph.forEach(function (_, node) {
      if (visited.has(node)) return;
      const stack = [node];
      const members = [];
      visited.add(node);

      while (stack.length) {
        const cur = stack.pop();
        members.push(cur);
        const neighbors = graph.get(cur) || new Set();
        neighbors.forEach(function (n) {
          if (!visited.has(n)) {
            visited.add(n);
            stack.push(n);
          }
        });
      }

      if (members.length >= 3) {
        let volume = 0;
        let txCount = 0;
        let maxDeg = 0;
        let hub = null;

        for (let i = 0; i < members.length; i += 1) {
          const m = members[i];
          const deg = (graph.get(m) || new Set()).size;
          if (deg > maxDeg) {
            maxDeg = deg;
            hub = m;
          }
        }

        members.forEach(function (a) {
          const neighbors = graph.get(a) || new Set();
          neighbors.forEach(function (b) {
            if (!members.includes(b)) return;
            const key = a + "|" + b;
            volume += volumeMap.get(key) || 0;
            txCount += edgeCounts.get(key) || 0;
          });
        });

        let label = "Generic cluster";
        if (maxDeg >= members.length * 0.6) {
          label = "Hub & spoke cluster";
        } else if (maxDeg <= 3 && members.length >= 8) {
          label = "Dense peer cluster";
        }

        clusters.push({
          size: members.length,
          txCount: txCount / 2,
          volume: volume / 2,
          label: label,
          hub: hub,
          accountsSample: members.slice(0, 6),
        });
      }
    });

    clusters.sort(function (a, b) {
      const scoreA = a.size + a.txCount / 5 + a.volume / 500;
      const scoreB = b.size + b.txCount / 5 + b.volume / 500;
      return scoreB - scoreA;
    });

    DeepAnalytics.clusters = clusters.slice(0, 6);
  }

  /* ---------- Burst & swarm detection ---------- */

  function detectBursts() {
    const txs = DeepAnalytics.txWindow;
    if (!txs.length) {
      DeepAnalytics.bursts = [];
      return;
    }

    const buckets = new Map(); // bucketKey -> {...}
    const bucketSizeMs = 10_000; // 10s windows
    let minTs = Infinity;

    for (let i = 0; i < txs.length; i += 1) {
      const tx = txs[i];
      if (!tx.time) continue;
      const ts = tx.time.getTime();
      if (!Number.isFinite(ts)) continue;
      if (ts < minTs) minTs = ts;
    }
    if (!Number.isFinite(minTs)) {
      DeepAnalytics.bursts = [];
      return;
    }

    for (let i = 0; i < txs.length; i += 1) {
      const tx = txs[i];
      if (!tx.time) continue;
      const ts = tx.time.getTime();
      if (!Number.isFinite(ts)) continue;

      const bucketIndex = Math.floor((ts - minTs) / bucketSizeMs);
      const key = String(bucketIndex);

      if (!buckets.has(key)) {
        buckets.set(key, {
          startTs: minTs + bucketIndex * bucketSizeMs,
          count: 0,
          accounts: new Set(),
          dests: new Set(),
          sameAmountCounter: new Map(),
        });
      }

      const b = buckets.get(key);
      b.count += 1;
      if (tx.account) b.accounts.add(tx.account);
      if (tx.destination) b.dests.add(tx.destination);

      const amt = parseXrpAmount(tx.amount);
      const amtKey = amt.toFixed(6);
      b.sameAmountCounter.set(
        amtKey,
        (b.sameAmountCounter.get(amtKey) || 0) + 1,
      );
    }

    const bursts = [];

    buckets.forEach(function (b) {
      const distinctAcc = b.accounts.size;
      const distinctDst = b.dests.size;

      if (b.count < 15 || distinctAcc < 4) return;

      let maxSameAmt = 0;
      b.sameAmountCounter.forEach(function (cnt) {
        if (cnt > maxSameAmt) maxSameAmt = cnt;
      });

      let kind = "General throughput burst";
      if (distinctDst === 1 && distinctAcc >= 5) {
        kind = "Swarm into single destination";
      } else if (maxSameAmt >= 6) {
        kind = "Coordinated same-amount burst";
      }

      bursts.push({
        startTs: b.startTs,
        count: b.count,
        accounts: distinctAcc,
        dests: distinctDst,
        maxSameAmt: maxSameAmt,
        kind: kind,
      });
    });

    bursts.sort(function (a, b) {
      return b.startTs - a.startTs;
    });

    DeepAnalytics.bursts = bursts.slice(0, 8);
  }

  /* ---------- Network behavior summary ---------- */

  function computeBehaviorMode() {
    const latest =
      DeepAnalytics.ledgerHistory[DeepAnalytics.ledgerHistory.length - 1];
    if (!latest || !latest.totalTx) {
      return {
        label: "Collecting…",
        sub: "Waiting for live ledgers",
        mix: null,
      };
    }

    const payShare = percent(latest.payment, latest.totalTx);
    const offerShare = percent(latest.offer, latest.totalTx);
    const nftShare = percent(latest.nft, latest.totalTx);
    const trustShare = percent(latest.trust, latest.totalTx);

    let label;
    let sub;

    if (payShare > 65 && offerShare < 20) {
      label = "Payment-Dominated";
      sub = "Retail or corridor transfers leading the flow.";
    } else if (offerShare > 45) {
      label = "Orderbook / AMM-Driven";
      sub = "Trading and liquidity ops dominate ledger activity.";
    } else if (nftShare > 20) {
      label = "NFT-Centric";
      sub = "XLS-20 operations are unusually elevated.";
    } else {
      label = "Balanced Mix";
      sub = "Payments, offers and protocol operations are in balance.";
    }

    if (trustShare > 10) {
      sub += " Elevated trustline churn indicates issuer or token events.";
    }

    return {
      label: label,
      sub: sub,
      mix: {
        payShare: payShare,
        offerShare: offerShare,
        nftShare: nftShare,
        trustShare: trustShare,
      },
    };
  }

  /* ---------- Rendering: top summary ---------- */

  function renderTopSummary() {
    const latest =
      DeepAnalytics.ledgerHistory[DeepAnalytics.ledgerHistory.length - 1];

    const mode = computeBehaviorMode();
    setText("an-mode-label", mode.label);
    setText("an-mode-sub", mode.sub);

    if (!latest) {
      setText("an-ledger-count", "—");
      setText("an-window-size", "—");
      setText("an-accounts-flagged", "—");
      return;
    }

    setText("an-ledger-count", latest.ledgerIndex.toLocaleString());
    setText(
      "an-window-size",
      DeepAnalytics.ledgerHistory.length +
        " ledgers, " +
        DeepAnalytics.txWindow.length +
        " tx window",
    );
    setText(
      "an-accounts-flagged",
      String(DeepAnalytics.accountProfiles.length || 0),
    );

    if (mode.mix) {
      setText(
        "an-mix-summary",
        "Payments " +
          mode.mix.payShare.toFixed(1) +
          "%, Offers " +
          mode.mix.offerShare.toFixed(1) +
          "%, NFTs " +
          mode.mix.nftShare.toFixed(1) +
          "%, TrustSet " +
          mode.mix.trustShare.toFixed(1) +
          "%",
      );
    } else {
      setText("an-mix-summary", "Waiting for mix data…");
    }
  }

  /* ---------- Rendering: account manipulation + risk ---------- */

  function renderAccountClassifier() {
    const container = qs("an-account-classifier");
    if (!container) return;

    if (!DeepAnalytics.txWindow.length) {
      container.innerHTML =
        '<div class="flow-line">Raw per-transaction window not available yet. Once xrpl-connection streams recent transactions into <code>state.recentTransactions</code>, this panel will show account behavior classifications and risk.</div>';
      return;
    }

    if (!DeepAnalytics.accountProfiles.length) {
      container.innerHTML =
        '<div class="flow-line">No behavior standing out yet in the current window.</div>';
      return;
    }

    container.innerHTML = DeepAnalytics.accountProfiles
      .map(function (p) {
        const lastStr = p.lastTime
          ? p.lastTime.toLocaleTimeString()
          : "—";

        const riskLabel =
          p.riskScore >= 75
            ? "High"
            : p.riskScore >= 45
            ? "Medium"
            : p.riskScore > 0
            ? "Low"
            : "None";

        const classBadge = (function () {
          if (p.classification === "Ping-Pong / Wash-like") return "tag-wash";
          if (p.classification === "Orderbook Spoof-like") return "tag-spoof";
          if (
            p.classification === "Whale Accumulator" ||
            p.classification === "Whale Distributor"
          )
            return "tag-whale";
          if (p.classification === "Airdrop / Farming-like")
            return "tag-airdrop";
          if (p.classification === "Bridge / Router-like")
            return "tag-router";
          if (p.riskScore >= 75) return "tag-highrisk";
          if (p.riskScore >= 45) return "tag-medrisk";
          return "tag-neutral";
        })();

        const reasonText =
          p.riskSignals && p.riskSignals.length
            ? p.riskSignals.join(" · ")
            : p.reasons && p.reasons.length
            ? p.reasons.join(" · ")
            : "No strong signals yet.";

        return (
          '<div class="an-account-item">' +
          '<div class="an-account-header">' +
          '<div class="an-account-line">' +
          '<span class="an-account-id">' +
          p.account +
          "</span>" +
          "</div>" +
          '<span class="an-badge ' +
          classBadge +
          '">' +
          p.classification +
          "</span>" +
          "</div>" +
          '<div class="an-account-metrics">' +
          "<span>" +
          p.totalTx +
          " tx • out " +
          p.sentVolume.toFixed(2) +
          " XRP • in " +
          p.recvVolume.toFixed(2) +
          " XRP</span>" +
          "<span>deg out " +
          p.outDeg +
          ", in " +
          p.inDeg +
          "</span>" +
          "<span>mean " +
          p.meanAmt.toFixed(2) +
          " XRP</span>" +
          "<span>risk " +
          p.riskScore.toFixed(0) +
          "/100 (" +
          riskLabel +
          ") · last " +
          lastStr +
          "</span>" +
          "</div>" +
          '<div class="an-account-reason">' +
          reasonText +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  /* ---------- Rendering: interaction graph ---------- */

  function renderInteractionGraph() {
    const canvas = qs("an-graph-canvas");
    const wrapper = qs("an-graph-wrapper");
    if (!canvas || !wrapper) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = wrapper.getBoundingClientRect();
    const width = Math.max(260, rect.width || 260);
    const height = Math.max(220, rect.height || 220);
    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);

    const txs = DeepAnalytics.txWindow.filter(function (tx) {
      return tx && tx.type === "Payment" && tx.account && tx.destination;
    });
    if (!txs.length) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        "Waiting for Payment flows (needs recentTransactions)…",
        width / 2,
        height / 2,
      );
      return;
    }

    const nodeMap = new Map();
    const edgeMap = new Map();

    for (let i = 0; i < txs.length; i += 1) {
      const tx = txs[i];
      const from = tx.account;
      const to = tx.destination;
      const amt = parseXrpAmount(tx.amount);

      if (!nodeMap.has(from)) {
        nodeMap.set(from, {
          id: from,
          out: 0,
          in: 0,
          volumeOut: 0,
          volumeIn: 0,
        });
      }
      if (!nodeMap.has(to)) {
        nodeMap.set(to, {
          id: to,
          out: 0,
          in: 0,
          volumeOut: 0,
          volumeIn: 0,
        });
      }

      const fromNode = nodeMap.get(from);
      const toNode = nodeMap.get(to);
      fromNode.out += 1;
      fromNode.volumeOut += amt;
      toNode.in += 1;
      toNode.volumeIn += amt;

      const key = from + "|" + to;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { from: from, to: to, count: 0, volume: 0 });
      }
      const e = edgeMap.get(key);
      e.count += 1;
      e.volume += amt;
    }

    let nodes = Array.from(nodeMap.values());
    if (nodes.length > 80) {
      nodes.sort(function (a, b) {
        const wa =
          a.out + a.in + a.volumeOut / 100 + a.volumeIn / 100;
        const wb =
          b.out + b.in + b.volumeOut / 100 + b.volumeIn / 100;
        return wb - wa;
      });
      nodes = nodes.slice(0, 80);
    }

    const nodeIndex = new Map();
    nodes.forEach(function (n, idx) {
      nodeIndex.set(n.id, idx);
    });

    const edges = Array.from(edgeMap.values()).filter(function (e) {
      return nodeIndex.has(e.from) && nodeIndex.has(e.to);
    });

    const nodesByWeight = nodes.slice().sort(function (a, b) {
      const wa =
        a.out + a.in + a.volumeOut / 200 + a.volumeIn / 200;
      const wb =
        b.out + b.in + b.volumeOut / 200 + b.volumeIn / 200;
      return wb - wa;
    });

    const centerCount = Math.min(1, nodesByWeight.length);
    const midCount = Math.min(10, nodesByWeight.length - centerCount);
    const outerCount = nodesByWeight.length - centerCount - midCount;

    const cx = width / 2;
    const cy = height / 2;
    const rMid = Math.min(width, height) * 0.25;
    const rOuter = Math.min(width, height) * 0.42;

    const positions = new Map();

    for (let i = 0; i < centerCount; i += 1) {
      const node = nodesByWeight[i];
      positions.set(node.id, { x: cx, y: cy });
    }

    for (let i = 0; i < midCount; i += 1) {
      const node = nodesByWeight[centerCount + i];
      const angle = (2 * Math.PI * i) / Math.max(1, midCount);
      positions.set(node.id, {
        x: cx + rMid * Math.cos(angle),
        y: cy + rMid * Math.sin(angle),
      });
    }

    for (let i = 0; i < outerCount; i += 1) {
      const node = nodesByWeight[centerCount + midCount + i];
      const angle = (2 * Math.PI * i) / Math.max(1, outerCount);
      positions.set(node.id, {
        x: cx + rOuter * Math.cos(angle),
        y: cy + rOuter * Math.sin(angle),
      });
    }

    const accent = getCssVar("--accent-primary", "#00d4ff");
    const accentSecondary = getCssVar("--accent-secondary", "#ffd700");

    ctx.save();
    ctx.lineWidth = 1;

    const maxEdgeCount =
      edges.reduce(function (max, e) {
        return e.count > max ? e.count : max;
      }, 1) || 1;

    edges.forEach(function (e) {
      const fromPos = positions.get(e.from);
      const toPos = positions.get(e.to);
      if (!fromPos || !toPos) return;

      const intensity = Math.min(e.count / maxEdgeCount, 1);
      const alpha = 0.1 + intensity * 0.45;
      ctx.strokeStyle = "rgba(255,255,255," + alpha.toFixed(3) + ")";

      ctx.beginPath();
      ctx.moveTo(fromPos.x, fromPos.y);
      ctx.lineTo(toPos.x, toPos.y);
      ctx.stroke();
    });

    ctx.restore();

    const maxDeg =
      nodes.reduce(function (max, n) {
        return Math.max(max, n.out + n.in);
      }, 1) || 1;

    const suspiciousIds = new Set(
      DeepAnalytics.accountProfiles
        .filter(function (p) {
          return (
            p.riskScore >= 60 &&
            p.classification !== "High-Activity Account"
          );
        })
        .map(function (p) {
          return p.account;
        }),
    );

    nodes.forEach(function (n) {
      const pos = positions.get(n.id);
      if (!pos) return;

      const deg = n.out + n.in;
      const baseRadius = 3 + (deg / maxDeg) * 7;
      const isSuspicious = suspiciousIds.has(n.id);

      const outerColor = isSuspicious
        ? accentSecondary
        : "rgba(255,255,255,0.7)";
      const innerColor = isSuspicious ? accent : "#ffffff";

      ctx.beginPath();
      ctx.arc(
        pos.x,
        pos.y,
        baseRadius + (isSuspicious ? 3 : 1),
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = outerColor + (isSuspicious ? "" : "88");
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, baseRadius, 0, Math.PI * 2);
      ctx.fillStyle = innerColor;
      ctx.fill();
    });
  }

  /* ---------- Rendering: anomaly radar ---------- */

  function renderAnomalies() {
    const container = qs("an-anomaly-feed");
    if (!container) return;

    if (!DeepAnalytics.anomalies.length) {
      container.innerHTML =
        '<div class="anomaly-item">No significant anomalies yet across throughput, mix, whales or load.</div>';
      return;
    }

    container.innerHTML = DeepAnalytics.anomalies
      .slice(0, 10)
      .map(function (a) {
        const dirSymbol = a.zScore > 0 ? "↑" : "↓";
        const severity =
          Math.abs(a.zScore) > 4.5
            ? "critical"
            : Math.abs(a.zScore) > 3.5
            ? "high"
            : "moderate";
        const cls = "anomaly-" + severity;
        const when = a.at.toLocaleTimeString();
        return (
          '<div class="anomaly-item ' +
          cls +
          '">' +
          '<div class="anomaly-main">' +
          '<span class="anomaly-metric">' +
          a.metric +
          "</span>" +
          '<span class="anomaly-value">' +
          dirSymbol +
          " z=" +
          a.zScore.toFixed(2) +
          "</span>" +
          "</div>" +
          '<div class="anomaly-sub">' +
          "Latest: " +
          a.value.toFixed(4) +
          " · Mean: " +
          a.mean.toFixed(4) +
          " (" +
          a.direction +
          ") · " +
          when +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  /* ---------- Rendering: flow genome ---------- */

  function renderFlowGenome() {
    const container = qs("an-flow-genome");
    if (!container) return;

    if (!DeepAnalytics.txWindow.length) {
      container.innerHTML =
        '<div class="flow-line">Waiting for transaction flow window…</div>';
      return;
    }

    if (!DeepAnalytics.patterns.length) {
      container.innerHTML =
        '<div class="flow-line">No strong structural patterns detected yet in the current window.</div>';
      return;
    }

    container.innerHTML = DeepAnalytics.patterns
      .map(function (pat) {
        const items = (pat.detail || []).slice(0, 6);
        const list = items
          .map(function (d) {
            if (d.path) {
              return (
                '<div class="flow-line"><span class="flow-account">' +
                d.path +
                '</span><span class="flow-metric">' +
                (d.hits || d.count || "") +
                " hits</span></div>"
              );
            }
            return (
              '<div class="flow-line"><span class="flow-account">' +
              d.node +
              '</span><span class="flow-metric">' +
              d.degree +
              " neighbors</span></div>"
            );
          })
          .join("");
        return (
          '<div class="flow-block">' +
          '<div class="flow-title">' +
          pat.kind +
          "</div>" +
          (list || '<div class="flow-line">No instances in window.</div>') +
          "</div>"
        );
      })
      .join("");
  }

  /* ---------- Rendering: metric correlations ---------- */

  function renderCorrelations() {
    const body = qs("an-corr-body");
    if (!body) return;

    const data = DeepAnalytics.ledgerHistory;
    if (data.length < 18) {
      body.innerHTML = '<tr><td colspan="3">Collecting data…</td></tr>';
      return;
    }

    const tpsSeries = data.map(function (p) {
      return p.tps;
    });
    const feeSeries = data.map(function (p) {
      return p.avgFee;
    });
    const loadSeries = data.map(function (p) {
      return p.load;
    });
    const txPerLedgerSeries = data.map(function (p) {
      return p.txPerLedger;
    });
    const nftShareSeries = data.map(function (p) {
      return percent(p.nft, p.totalTx || 1);
    });
    const ammVolumeSeries = data.map(function (p) {
      return p.ammVolume || 0;
    });

    const rows = [
      {
        label: "TPS ↔ Avg Fee",
        r: pearsonCorrelation(tpsSeries, feeSeries),
      },
      {
        label: "TPS ↔ Network Load",
        r: pearsonCorrelation(tpsSeries, loadSeries),
      },
      {
        label: "Tx / Ledger ↔ Avg Fee",
        r: pearsonCorrelation(txPerLedgerSeries, feeSeries),
      },
      {
        label: "NFT Share ↔ AMM Volume",
        r: pearsonCorrelation(nftShareSeries, ammVolumeSeries),
      },
    ];

    body.innerHTML = rows
      .map(function (row) {
        const desc = describeCorrelation(row.r);
        const rText =
          row.r === null || !Number.isFinite(row.r)
            ? "—"
            : row.r.toFixed(2);
        return (
          "<tr>" +
          "<td>" +
          row.label +
          "</td>" +
          "<td>" +
          rText +
          "</td>" +
          "<td>" +
          desc +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  /* ---------- Rendering: clusters ---------- */

  function renderClusters() {
    const container = qs("an-cluster-feed");
    if (!container) return;

    if (!DeepAnalytics.txWindow.length) {
      container.innerHTML =
        '<div class="flow-line">Waiting for transaction graph…</div>';
      return;
    }

    if (!DeepAnalytics.clusters.length) {
      container.innerHTML =
        '<div class="flow-line">No connected account clusters above the minimum size yet.</div>';
      return;
    }

    container.innerHTML = DeepAnalytics.clusters
      .map(function (c) {
        const sample =
          c.accountsSample && c.accountsSample.length
            ? c.accountsSample.join(", ")
            : "—";
        return (
          '<div class="flow-line">' +
          '<div class="flow-account">' +
          c.label +
          " (" +
          c.size +
          " accounts)" +
          "</div>" +
          '<div class="flow-metric">' +
          c.txCount +
          " tx · " +
          c.volume.toFixed(1) +
          " XRP<br/><span style=\"font-size:0.78em;color:var(--text-secondary);\">Sample: " +
          sample +
          "</span></div>" +
          "</div>"
        );
      })
      .join("");
  }

  /* ---------- Rendering: bursts & swarms ---------- */

  function renderBursts() {
    const container = qs("an-burst-feed");
    if (!container) return;

    if (!DeepAnalytics.txWindow.length) {
      container.innerHTML =
        '<div class="flow-line">Waiting for temporal activity window…</div>';
      return;
    }

    if (!DeepAnalytics.bursts.length) {
      container.innerHTML =
        '<div class="flow-line">No strong bursts or swarms detected in the recent window.</div>';
      return;
    }

    container.innerHTML = DeepAnalytics.bursts
      .map(function (b) {
        const when = new Date(b.startTs).toLocaleTimeString();
        return (
          '<div class="flow-line">' +
          '<span class="flow-account">' +
          when +
          " – " +
          b.kind +
          "</span>" +
          '<span class="flow-metric">' +
          b.count +
          " tx · " +
          b.accounts +
          " accounts · " +
          b.dests +
          " destinations" +
          (b.maxSameAmt >= 3
            ? " · same-amount streak " + b.maxSameAmt
            : "") +
          "</span>" +
          "</div>"
        );
      })
      .join("");
  }

  /* ---------- Rendering: explanation / knowledge panel ---------- */

  function renderExplainPanel() {
    const container = qs("an-explain-panel");
    if (!container) return;

    container.innerHTML =
      '<div class="explain-block">' +
      "<div class=\"explain-title\">Behavioral Mode</div>" +
      "<div class=\"explain-text\">" +
      "The top cards look at ledger-level mix: share of Payments vs Offers vs NFTs vs TrustSet. " +
      "When payments dominate and offers are low, we label the mode as <b>Payment-Dominated</b>. " +
      "When offers dominate, it becomes <b>Orderbook / AMM-Driven</b>. Elevated TrustSet share hints at issuer/token events." +
      "</div>" +
      "</div>" +
      "<div class=\"explain-block\">" +
      "<div class=\"explain-title\">Risk Score (0–100)</div>" +
      "<div class=\"explain-text\">" +
      "<b>Per-account risk</b> combines several on-chain signals over the recent window:<br/>" +
      "<ul>" +
      "<li>Volume &amp; activity – how many tx and how much XRP moved in/out.</li>" +
      "<li>Graph shape – fan-in / fan-out (degree), hubs vs routers.</li>" +
      "<li>Patterns – repeated fixed amounts, back-and-forth flows, cancel-heavy offers.</li>" +
      "<li>Recency – very recent, intense activity scores higher than old activity.</li>" +
      "</ul>" +
      "None of this is proof of wrongdoing – it is a <b>heuristic anomaly score</b> to help you prioritize what to inspect manually." +
      "</div>" +
      "</div>" +
      "<div class=\"explain-block\">" +
      "<div class=\"explain-title\">Behavior Labels</div>" +
      "<div class=\"explain-text\">" +
      "<ul>" +
      "<li><b>Whale Accumulator</b> – receives much more volume than it sends, with many distinct sources.</li>" +
      "<li><b>Whale Distributor</b> – sends large volume to many destinations, often after prior accumulation.</li>" +
      "<li><b>Ping-Pong / Wash-like</b> – repeated back-and-forth flows with similar amounts between few accounts.</li>" +
      "<li><b>Orderbook Spoof-like</b> – heavy OfferCreate + OfferCancel ratio, many orders that never seem to rest.</li>" +
      "<li><b>Airdrop / Farming-like</b> – many small payments combined with TrustSet changes.</li>" +
      "<li><b>Bridge / Router-like</b> – mostly sends, barely ever receives, across many recipients.</li>" +
      "</ul>" +
      "</div>" +
      "</div>" +
      "<div class=\"explain-block\">" +
      "<div class=\"explain-title\">Clusters, Bursts &amp; Flow Genome</div>" +
      "<div class=\"explain-text\">" +
      "<ul>" +
      "<li><b>Clusters</b> group accounts that talk to each other a lot in the current window.</li>" +
      "<li><b>Bursts &amp; Swarms</b> are short windows (≈10s) with unusually dense activity or many accounts hitting the same destination.</li>" +
      "<li><b>Flow Genome</b> shows structural motifs: hubs, aggregators, ping-pong rings, and 3-hop corridors.</li>" +
      "</ul>" +
      "These structures are helpful to spot coordinated behavior and potential manipulation-like patterns, " +
      "but they still need human context (who the accounts are, what asset is moving, off-chain news, etc.)." +
      "</div>" +
      "</div>" +
      "<div class=\"explain-block\">" +
      "<div class=\"explain-title\">Important Disclaimer</div>" +
      "<div class=\"explain-text\">" +
      "This engine points out <b>anomalies and patterns</b>, not guilt. " +
      "Use these signals as starting points for deeper research, not as definitive evidence of malicious intent." +
      "</div>" +
      "</div>";
  }

  /* ---------- Rendering: summary / deep-dive cues ---------- */

  function renderSummaryPanel() {
    const container = qs("an-summary-panel");
    if (!container) return;

    const profiles = DeepAnalytics.accountProfiles || [];
    const clusters = DeepAnalytics.clusters || [];
    const bursts = DeepAnalytics.bursts || [];

    if (
      !profiles.length &&
      !clusters.length &&
      !bursts.length
    ) {
      container.innerHTML =
        '<div class="flow-line">Waiting for enough activity to build a meaningful summary…</div>';
      return;
    }

    const highRisk = profiles
      .filter(function (p) {
        return p.riskScore >= 70;
      })
      .slice(0, 3);

    const mediumRisk = profiles
      .filter(function (p) {
        return p.riskScore >= 40 && p.riskScore < 70;
      })
      .slice(0, 3);

    const topClusters = clusters.slice(0, 3);
    const topBursts = bursts.slice(0, 3);

    let html = "";

    html +=
      '<div class="summary-block">' +
      '<div class="summary-title">Priority accounts to inspect</div>';

    if (!highRisk.length && !mediumRisk.length) {
      html +=
        '<div class="summary-line">No elevated-risk accounts in the current window. As more flow comes in, this panel will surface potential points of interest.</div>';
    } else {
      if (highRisk.length) {
        html +=
          '<div class="summary-subtitle">High-risk band (70–100)</div>';
        highRisk.forEach(function (p) {
          html +=
            '<div class="summary-line">' +
            "<b>" +
            p.account +
            "</b> – " +
            "risk " +
            p.riskScore.toFixed(0) +
            "/100, " +
            p.totalTx +
            " tx, out " +
            p.sentVolume.toFixed(1) +
            " XRP, in " +
            p.recvVolume.toFixed(1) +
            " XRP" +
            "<br/><span class=\"summary-note\">Signals: " +
            (p.riskSignals && p.riskSignals.length
              ? p.riskSignals.join(", ")
              : "general high activity") +
            "</span>" +
            "</div>";
        });
      }
      if (mediumRisk.length) {
        html +=
          '<div class="summary-subtitle" style="margin-top:8px;">Medium-risk band (40–70)</div>';
        mediumRisk.forEach(function (p) {
          html +=
            '<div class="summary-line">' +
            "<b>" +
            p.account +
            "</b> – risk " +
            p.riskScore.toFixed(0) +
            "/100, " +
            p.totalTx +
            " tx" +
            "<br/><span class=\"summary-note\">Signals: " +
            (p.riskSignals && p.riskSignals.length
              ? p.riskSignals.join(", ")
              : "moderate anomaly mix") +
            "</span>" +
            "</div>";
        });
      }
    }

    html += "</div>";

    html +=
      '<div class="summary-block">' +
      '<div class="summary-title">Network patterns worth a deeper look</div>';

    if (!topClusters.length && !topBursts.length) {
      html +=
        '<div class="summary-line">No strong structural or temporal patterns in the current window.</div>';
    } else {
      if (topClusters.length) {
        html +=
          '<div class="summary-subtitle">Account clusters</div>';
        topClusters.forEach(function (c) {
          const hubLabel = c.hub ? "hub " + c.hub + ", " : "";
          html +=
            '<div class="summary-line">' +
            "<b>" +
            c.label +
            "</b> – " +
            c.size +
            " accounts, " +
            c.txCount +
            " tx, " +
            c.volume.toFixed(1) +
            " XRP" +
            "<br/><span class=\"summary-note\">" +
            hubLabel +
            "sample: " +
            (c.accountsSample && c.accountsSample.length
              ? c.accountsSample.join(", ")
              : "—") +
            "</span>" +
            "</div>";
        });
      }

      if (topBursts.length) {
        html +=
          '<div class="summary-subtitle" style="margin-top:8px;">Bursts &amp; swarms</div>';
        topBursts.forEach(function (b) {
          const when = new Date(b.startTs).toLocaleTimeString();
          html +=
            '<div class="summary-line">' +
            "<b>" +
            when +
            "</b> – " +
            b.kind +
            " (" +
            b.count +
            " tx, " +
            b.accounts +
            " accounts, " +
            b.dests +
            " destinations" +
            (b.maxSameAmt >= 3
              ? ", same-amount streak " + b.maxSameAmt
              : "") +
            ")" +
            "</div>";
        });
      }
    }

    html += "</div>";

    html +=
      '<div class="summary-block">' +
      '<div class="summary-title">How to use this summary</div>' +
      '<div class="summary-line summary-note">' +
      "• Start with high-risk accounts and clusters; cross-check them with assets, orderbooks, and off-chain context.<br/>" +
      "• For ping-pong or spoof-like labels, look at time-aligned orderbook / price moves to see if the pattern lines up with manipulation-like behavior.<br/>" +
      "• Treat all of this as a <b>map of anomalies</b>, not accusations – it is here to help you decide where to zoom in next." +
      "</div>" +
      "</div>";

    container.innerHTML = html;
  }

  /* ---------- Rendering orchestration ---------- */

  function renderAnalytics() {
    const now = nowTs();
    if (now - DeepAnalytics.lastRender < MIN_RENDER_INTERVAL_MS) return;
    DeepAnalytics.lastRender = now;

    renderTopSummary();
    renderAccountClassifier();
    renderInteractionGraph();
    renderAnomalies();
    renderFlowGenome();
    renderCorrelations();
    renderClusters();
    renderBursts();
    renderExplainPanel();
    renderSummaryPanel();
  }

  /* ---------- Event listener ---------- */

  function onLedgerEvent(ev) {
    const state = ev.detail;
    DeepAnalytics.lastState = state;

    addLedgerSnapshot(state);
    updateTxWindowFromState(state);
    buildAccountProfiles();
    detectFlowGenome();
    detectClusters();
    detectBursts();

    if (
      window.UI &&
      window.UI.currentPage &&
      window.UI.currentPage !== "analytics"
    ) {
      return;
    }
    renderAnalytics();
  }

  /* ---------- HTML skeleton ---------- */

  function buildAnalyticsHtml() {
    return (
      '<div class="chart-section">' +
      '<div class="chart-title">🧠 Deep Ledger Intelligence</div>' +
      '<div class="dashboard-grid" style="grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); margin-bottom: 20px;">' +
      '<div class="metric-card">' +
      '<div class="metric-label">Behavioral Mode</div>' +
      '<div class="live-value" id="an-mode-label">Collecting…</div>' +
      '<div class="metric-sub" id="an-mode-sub">Waiting for ledgers…</div>' +
      "</div>" +
      '<div class="metric-card">' +
      '<div class="metric-label">Latest Ledger</div>' +
      '<div class="live-value" id="an-ledger-count">—</div>' +
      '<div class="metric-sub" id="an-mix-summary">—</div>' +
      "</div>" +
      '<div class="metric-card">' +
      '<div class="metric-label">Window</div>' +
      '<div class="live-value" id="an-window-size">—</div>' +
      "</div>" +
      '<div class="metric-card">' +
      '<div class="metric-label">Accounts Flagged</div>' +
      '<div class="live-value" id="an-accounts-flagged">—</div>' +
      "</div>" +
      "</div>" +
      '<div class="analytics-grid" style="display:grid;grid-template-columns: minmax(0,2.1fr) minmax(0,2.4fr) minmax(0,2fr);gap:20px;margin-bottom:20px;">' +
      '<div class="metric-box" style="background:var(--card-bg);border:2px solid var(--accent-tertiary);border-radius:12px;padding:16px;min-height:220px;">' +
      '<div class="metric-title" style="margin-bottom:4px;">Account Manipulation & Risk</div>' +
      '<div class="metric-subtitle" style="font-size:0.85em;color:var(--text-secondary);margin-bottom:10px;">' +
      "Heuristics for whales, spoofing, wash-like ping-pong, airdrop farming, router-style behavior and a 0–100 risk score." +
      "</div>" +
      '<div id="an-account-classifier" class="an-account-list" style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto;">' +
      '<div class="flow-line">Collecting transaction flows…</div>' +
      "</div>" +
      "</div>" +
      '<div class="metric-box" style="background:var(--card-bg);border:2px solid var(--accent-tertiary);border-radius:12px;padding:16px;min-height:220px;">' +
      '<div class="metric-title" style="margin-bottom:4px;">Interaction Web</div>' +
      '<div class="metric-subtitle" style="font-size:0.85em;color:var(--text-secondary);margin-bottom:10px;">' +
      "Payment graph of recent accounts. Thickness = intensity, glow = high-risk accounts." +
      "</div>" +
      '<div id="an-graph-wrapper" style="position:relative;width:100%;height:260px;">' +
      '<canvas id="an-graph-canvas" style="width:100%;height:100%;display:block;border-radius:12px;"></canvas>' +
      "</div>" +
      "</div>" +
      '<div class="metric-box" style="background:var(--card-bg);border:2px solid var(--accent-tertiary);border-radius:12px;padding:16px;min-height:220px;">' +
      '<div class="metric-title" style="margin-bottom:4px;">Anomaly Radar</div>' +
      '<div class="metric-subtitle" style="font-size:0.85em;color:var(--text-secondary);margin-bottom:10px;">' +
      "Z-score spikes across TPS, mix, whales, intervals and load." +
      "</div>" +
      '<div id="an-anomaly-feed" class="anomaly-feed" style="display:flex;flex-direction:column;gap:6px;max-height:190px;overflow-y:auto;">' +
      '<div class="anomaly-item">Waiting for data…</div>' +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="metrics-grid" style="display:grid;grid-template-columns: minmax(0,2.6fr) minmax(0,2.1fr);gap:20px;margin-bottom:20px;">' +
      '<div class="metric-box" style="background:var(--card-bg);border:2px solid var(--accent-tertiary);border-radius:12px;padding:16px;">' +
      '<div class="metric-title" style="margin-bottom:4px;">Flow Genome</div>' +
      '<div class="metric-subtitle" style="font-size:0.85em;color:var(--text-secondary);margin-bottom:10px;">' +
      "Structural patterns across the payment graph: hubs, aggregators, rings and corridor-like paths." +
      "</div>" +
      '<div id="an-flow-genome" class="flow-genome" style="display:flex;flex-direction:column;gap:10px;font-size:0.9em;">' +
      '<div class="flow-line">Waiting for transaction window…</div>' +
      "</div>" +
      "</div>" +
      '<div class="metric-box" style="background:var(--card-bg);border:2px solid var(--accent-tertiary);border-radius:12px;padding:16px;">' +
      '<div class="metric-title" style="margin-bottom:4px;">Metric Correlations</div>' +
      '<div class="metric-subtitle" style="font-size:0.85em;color:var(--text-secondary);margin-bottom:10px;">' +
      "Relationship between throughput, fees, network load, Tx density and NFT/AMM activity." +
      "</div>" +
      '<div class="correlation-table-wrapper" style="overflow-x:auto;">' +
      '<table class="correlation-table" style="width:100%;border-collapse:collapse;font-size:0.9em;">' +
      "<thead>" +
      "<tr>" +
      '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.1);">Pair</th>' +
      '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.1);">r</th>' +
      '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.1);">Interpretation</th>' +
      "</tr>" +
      "</thead>" +
      '<tbody id="an-corr-body">' +
      '<tr><td colspan="3">Collecting data…</td></tr>' +
      "</tbody>" +
      "</table>" +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="metrics-grid" style="display:grid;grid-template-columns: minmax(0,2.6fr) minmax(0,2.1fr);gap:20px;margin-bottom:20px;">' +
      '<div class="metric-box" style="background:var(--card-bg);border:2px solid var(--accent-tertiary);border-radius:12px;padding:16px;">' +
      '<div class="metric-title" style="margin-bottom:4px;">Account Clusters</div>' +
      '<div class="metric-subtitle" style="font-size:0.85em;color:var(--text-secondary);margin-bottom:10px;">' +
      "Connected groups of accounts interacting heavily in the current window." +
      "</div>" +
      '<div id="an-cluster-feed" class="flow-genome" style="display:flex;flex-direction:column;gap:8px;font-size:0.9em;">' +
      '<div class="flow-line">Waiting for transaction graph…</div>' +
      "</div>" +
      "</div>" +
      '<div class="metric-box" style="background:var(--card-bg);border:2px solid var(--accent-tertiary);border-radius:12px;padding:16px;">' +
      '<div class="metric-title" style="margin-bottom:4px;">Bursts & Swarms</div>' +
      '<div class="metric-subtitle" style="font-size:0.85em;color:var(--text-secondary);margin-bottom:10px;">' +
      "Temporal coordination: short-window bursts, swarms into single destinations and repeated same-amount waves." +
      "</div>" +
      '<div id="an-burst-feed" class="flow-genome" style="display:flex;flex-direction:column;gap:8px;font-size:0.9em;">' +
      '<div class="flow-line">Waiting for temporal patterns…</div>' +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="metrics-grid" style="display:grid;grid-template-columns: minmax(0,2.6fr) minmax(0,2.1fr);gap:20px;">' +
      '<div class="metric-box" style="background:var(--card-bg);border:2px solid var(--accent-tertiary);border-radius:12px;padding:16px;">' +
      '<div class="metric-title" style="margin-bottom:4px;">How this engine thinks</div>' +
      '<div class="metric-subtitle" style="font-size:0.85em;color:var(--text-secondary);margin-bottom:10px;">' +
      "Explanation of the metrics, labels and risk score so you can interpret patterns correctly." +
      "</div>" +
      '<div id="an-explain-panel" class="explain-panel" style="display:flex;flex-direction:column;gap:8px;font-size:0.9em;max-height:360px;overflow-y:auto;">' +
      '<div class="flow-line">Loading explanation…</div>' +
      "</div>" +
      "</div>" +
      '<div class="metric-box" style="background:var(--card-bg);border:2px solid var(--accent-tertiary);border-radius:12px;padding:16px;">' +
      '<div class="metric-title" style="margin-bottom:4px;">Summary & Deep-Dive Cues</div>' +
      '<div class="metric-subtitle" style="font-size:0.85em;color:var(--text-secondary);margin-bottom:10px;">' +
      "High-level takeaways: which accounts, clusters and bursts look most interesting to investigate next." +
      "</div>" +
      '<div id="an-summary-panel" class="summary-panel" style="display:flex;flex-direction:column;gap:8px;font-size:0.9em;max-height:360px;overflow-y:auto;">' +
      '<div class="flow-line">Building summary…</div>' +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  /* ---------- Init / cleanup ---------- */

  function initAnalytics() {
    try {
      const container = qs("analytics");
      if (!container) {
        console.warn("Analytics container #analytics not found.");
        return;
      }

      container.innerHTML = buildAnalyticsHtml();
      DeepAnalytics.ledgerHistory = [];
      DeepAnalytics.txWindow = [];
      DeepAnalytics.anomalies = [];
      DeepAnalytics.patterns = [];
      DeepAnalytics.accountProfiles = [];
      DeepAnalytics.clusters = [];
      DeepAnalytics.bursts = [];
      DeepAnalytics.lastRender = 0;
      DeepAnalytics.lastState = null;

      if (DeepAnalytics.ledgerListener) {
        window.removeEventListener("xrpl-ledger", DeepAnalytics.ledgerListener);
      }
      DeepAnalytics.ledgerListener = onLedgerEvent;
      window.addEventListener("xrpl-ledger", DeepAnalytics.ledgerListener);

      DeepAnalytics.initialized = true;
      console.log("🧠 Deep Intelligence Analytics initialized");

      const initialState = window.getXRPLState
        ? window.getXRPLState()
        : null;
      if (initialState) {
        DeepAnalytics.lastState = initialState;
        addLedgerSnapshot(initialState);
        updateTxWindowFromState(initialState);
        buildAccountProfiles();
        detectFlowGenome();
        detectClusters();
        detectBursts();
        renderAnalytics();
      }
    } catch (err) {
      console.error("Analytics init error", err);
      const container = qs("analytics");
      if (container) {
        container.innerHTML =
          '<div class="chart-section"><div class="chart-title">🧠 Analytics</div><div style="padding:40px;text-align:center;">Failed to initialize analytics.</div></div>';
      }
    }
  }

  function cleanupAnalytics() {
    try {
      if (DeepAnalytics.ledgerListener) {
        window.removeEventListener("xrpl-ledger", DeepAnalytics.ledgerListener);
        DeepAnalytics.ledgerListener = null;
      }
      DeepAnalytics.initialized = false;
    } catch (err) {
      console.warn("Analytics cleanup error", err);
    }
  }

  window.initAnalytics = initAnalytics;
  window.cleanupAnalytics = cleanupAnalytics;

  console.log("🧠 NaluXrp Deep Intelligence Analytics loaded");
})();
