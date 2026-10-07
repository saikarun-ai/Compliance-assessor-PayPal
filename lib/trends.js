'use strict';

/**
 * Trend report synthesis: Agent Reach signals -> structured influencer report.
 *
 * FR-22 (combine YouTube + Exa), FR-24 (platforms, sentiment, angle,
 * engagement), FR-25 (pricing band). Statistics are always computed in code;
 * the LLM only writes the narrative summary and the content angle, so a dead
 * llama-server still produces a complete report.
 */

const agentReach = require('./agentReach');
const llama = require('./llama');
const logger = require('./logger');
const store = require('./store');

const CACHE_HOURS = Number(process.env.TREND_CACHE_HOURS || 24);
const NICHE_RPM_USD = 22; // conservative blended creator RPM for English tech content
const PLATFORM_NAMES = {
  youtube: 'YouTube',
  exa: 'Web (Exa)',
  rss: 'News / RSS',
  subtitles: 'YouTube transcripts',
};

const POSITIVE_WORDS = ['best', 'top', 'new', 'guide', 'how to', 'tips', 'boost', 'grow', 'fast', 'easy', 'free', 'review', 'vs'];
const NEGATIVE_WORDS = ['warning', 'avoid', 'mistake', 'scam', 'bad', 'worst', 'risky', 'ban', 'suspended', 'cut', 'fail'];

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

// Note: match against the haystack, not the pattern. `new RegExp(a, b).match(x)`
// parses as `new RegExp(a, b.match(x))` because `new` swallows its argument list.
const countHits = (text, words) => words.reduce((total, word) => (
  total + (String(text).match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
), 0);

/** Deterministic sentiment from title + transcript language (FR-24). */
const analyseSentiment = (corpus) => {
  const positive = countHits(corpus, POSITIVE_WORDS);
  const negative = countHits(corpus, NEGATIVE_WORDS);
  const total = positive + negative;
  if (!total) {
    return { label: 'neutral', score: 0, positive_hits: 0, negative_hits: 0 };
  }
  const score = Number(((positive - negative) / total).toFixed(2));
  const label = score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'mixed';
  return { label, score, positive_hits: positive, negative_hits: negative };
};

/** Top recurring topic phrases from titles, used when the LLM is unavailable. */
const extractThemes = (videos) => {
  const stop = new Set(['the', 'a', 'for', 'to', 'of', 'in', 'and', 'with', 'best', 'top', 'my', 'your', 'how', 'what', 'new']);
  const counts = new Map();
  videos.forEach((video) => {
    const words = String(video.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter((word) => word.length > 3 && !stop.has(word));
    words.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
};

const summarise = (videos, medianViews, engagementRate, themes) => {
  const top = videos.slice(0, 3).map((video) => video.title).filter(Boolean);
  return `${videos.length} recent YouTube uploads in this niche median ${medianViews.toLocaleString('en-IN')} views, `
    + `with a top-quartile engagement rate near ${engagementRate}%. Recurring themes: ${themes.join(', ')}.`
    + (top.length ? ` Leading titles include "${top[0]}".` : '');
};

const SYSTEM_PROMPT = `You are an influencer strategy analyst.
Given YouTube + web research for a niche, return ONE JSON object:
{"trend_summary":"2-3 sentences on what is trending now",
 "content_angle":"one specific, shootable video idea with a hook",
 "sentiment":"positive|mixed|negative|neutral",
 "call_to_action":"one line a brand could sponsor",
 "pricing_band_usd":{"low":0,"high":0,"basis":"one short sentence"}}
Base the pricing band on realistic sponsorship rates for the stated audience size and engagement.
No markdown, no extra keys.`;

const askModel = async (context) => {
  try {
    const { data } = await llama.chatJson(SYSTEM_PROMPT, context);
    const band = data.pricing_band_usd || {};
    const low = Number(band.low);
    const high = Number(band.high);
    // A 1B model will happily answer {"low":0,"high":0}; treat that as no answer.
    const bandUsable = Number.isFinite(low) && Number.isFinite(high) && low > 0 && high >= low;
    return {
      used: true,
      trend_summary: String(data.trend_summary || '').slice(0, 600),
      content_angle: String(data.content_angle || '').slice(0, 400),
      call_to_action: String(data.call_to_action || '').slice(0, 200),
      sentiment: ['positive', 'mixed', 'negative', 'neutral'].includes(data.sentiment) ? data.sentiment : null,
      pricing_band: bandUsable
        ? { low, high, basis: String(band.basis || '').slice(0, 200) }
        : null,
    };
  } catch (err) {
    logger.warn(`trend narrative unavailable: ${err.message}`);
    return { used: false };
  }
};

const collect = async (niche) => {
  const [youtube, exa, rss] = await Promise.all([
    agentReach.searchYouTube(niche),
    agentReach.searchExa(niche),
    agentReach.fetchRss(niche),
  ]);
  const videos = youtube.items || [];
  const subtitles = videos.length ? await agentReach.fetchSubtitles(videos) : { transcripts: [] };
  return {
    channels: { youtube, exa, rss },
    videos,
    transcripts: subtitles.transcripts || [],
  };
};

/** FR-24 / FR-25. */
const generateReport = async (niche, { useCache = true, persist = true } = {}) => {
  const cleanNiche = String(niche || '').trim();
  if (!cleanNiche) throw new Error('niche is required');
  if (cleanNiche.length > 120) throw new Error('niche must be under 120 characters');

  if (useCache) {
    const cached = store.findCachedReport(cleanNiche, CACHE_HOURS);
    if (cached) {
      logger.info(`trend cache hit for "${cleanNiche}"`);
      return { ...cached, cached: true };
    }
  }

  const startedAt = Date.now();
  const { channels, videos, transcripts } = await collect(cleanNiche);

  if (!videos.length && !channels.rss.ok && !channels.exa.ok) {
    throw new Error('no Agent Reach channel returned data — check `agent-reach doctor`');
  }

  const views = videos.map((video) => video.views).filter((value) => value > 0);
  const medianViews = median(views);
  const totalViews = views.reduce((sum, view) => sum + view, 0);
  const topViews = views.slice(0, Math.max(1, Math.ceil(views.length * 0.25)));
  // Concentration: what share of total views the top quartile commands. Bounded
  // to 25-100%, which is why it cannot report the 1000%+ a raw ratio produces.
  const engagementRate = totalViews
    ? Number(((topViews.reduce((sum, view) => sum + view, 0) / totalViews) * 100).toFixed(1))
    : 0;
  // How far the breakout videos run above the niche median, as a multiple.
  const viewMultiplier = medianViews
    ? Number((mean(topViews) / medianViews).toFixed(1))
    : 0;
  const corpus = [
    ...videos.map((video) => video.title),
    ...(channels.rss.items || []).map((item) => item.title),
    ...transcripts.map((item) => item.words),
  ].join(' ').toLowerCase();

  const sentiment = analyseSentiment(corpus);
  const themes = extractThemes([...videos, ...(channels.rss.items || [])].map((item) => ({ title: item.title })));
  const platforms = Object.entries(channels)
    .filter(([, result]) => result.ok)
    .map(([key]) => PLATFORM_NAMES[key]);

  const suggested = Math.round(((medianViews / 1000) * NICHE_RPM_USD) / 50) * 50;
  const fallbackBand = {
    low: Math.max(200, Math.round(suggested * 0.7)),
    high: Math.max(400, Math.round(suggested * 1.35)),
    basis: `Median ${medianViews.toLocaleString('en-IN')} views at ~$${NICHE_RPM_USD} blended RPM, rounded to a sponsorship band.`,
  };

  const context = [
    `Niche: ${cleanNiche}`,
    `Top videos: ${videos.slice(0, 5).map((v) => `"${v.title}" (${v.views.toLocaleString('en-IN')} views)`).join('; ') || 'none'}`,
    `Median views: ${medianViews.toLocaleString('en-IN')}`,
    `Top quartile share of views: ${engagementRate}% (${viewMultiplier}x the median)`,
    `Headline themes: ${themes.join(', ')}`,
    `Language sentiment: ${sentiment.label} (score ${sentiment.score})`,
    channels.rss.items.length ? `News: ${channels.rss.items.map((i) => i.title).join('; ')}` : '',
    channels.exa.ok ? `Web research: ${channels.exa.items.map((i) => i.snippet).join(' ').slice(0, 800)}` : '',
    transcripts.length ? `Transcript sample: ${transcripts[0].words.slice(0, 600)}` : '',
  ].filter(Boolean).join('\n');

  const narrative = await askModel(context);

  const report = {
    id: store.newId('trd'),
    niche: cleanNiche,
    trend_summary: narrative.trend_summary || summarise(videos, medianViews, engagementRate, themes),
    top_platforms: platforms.length ? platforms.join(', ') : 'none',
    sentiment: narrative.sentiment || sentiment.label,
    sentiment_detail: sentiment,
    content_angle: narrative.content_angle
      || `Ship a "${themes[0] || cleanNiche} in ${new Date().getFullYear()}" teardown: hook on the top-performing format, show the ${themes[1] || 'workflow'}, end on the ${themes[2] || 'result'}.`,
    call_to_action: narrative.call_to_action || '',
    pricing_band: narrative.pricing_band
      ? `${narrative.pricing_band.low}-${narrative.pricing_band.high} USD` : `${fallbackBand.low}-${fallbackBand.high} USD`,
    pricing_band_usd: narrative.pricing_band || fallbackBand,
    engagement_rate: engagementRate,
    view_multiplier: viewMultiplier,
    median_views: medianViews,
    total_views: totalViews,
    themes,
    sources: {
      youtube: channels.youtube.ok ? videos.length : 0,
      exa: channels.exa.ok ? channels.exa.items.length : 0,
      rss: channels.rss.ok ? channels.rss.items.length : 0,
      transcripts: transcripts.length,
      skipped: Object.entries(channels).filter(([, result]) => !result.ok).map(([key, result]) => `${key}: ${result.reason}`),
    },
    top_videos: videos.slice(0, 5),
    raw_data: { channels, transcripts },
    llm_used: narrative.used,
    duration_ms: Date.now() - startedAt,
    created_at: new Date().toISOString(),
  };

  if (persist) store.addTrendReport(report);
  return { ...report, cached: false };
};

module.exports = { generateReport, analyseSentiment, extractThemes, CACHE_HOURS };
