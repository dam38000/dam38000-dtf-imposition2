// ============================================================
//  pricing.js — Tables de prix PMT (tarif catalogue 2026)
// ============================================================

export const FORMAT_MULTIPLES = { 'A3': 2, 'A4': 4, 'A5': 8, 'A6': 16 };

export const roundToMultiple = (nb, format) => {
  const m = FORMAT_MULTIPLES[format];
  if (!m || m <= 1) return nb;
  return Math.ceil(nb / m) * m;
};

export const getPrixUnitaire = (format, nbPlanches, table) => {
  const lignes = table[format];
  if (!lignes || nbPlanches <= 0) return null;
  const ligne = lignes.find(l => nbPlanches >= l.min && nbPlanches <= l.max);
  return ligne ? ligne.pu : null;
};

export const PRIX_TABLES = {
  // ── DTF (tarifs -30% déjà appliqués) ──
  DTF: {
    '1M': [
      {min:1,max:1,pu:19.60},{min:2,max:2,pu:19.04},{min:3,max:3,pu:18.20},{min:4,max:4,pu:17.22},
      {min:5,max:5,pu:16.86},{min:6,max:6,pu:16.52},{min:7,max:7,pu:16.24},{min:8,max:8,pu:15.82},
      {min:9,max:9,pu:15.42},{min:10,max:10,pu:15.12},{min:11,max:11,pu:14.84},{min:12,max:12,pu:14.42},
      {min:13,max:13,pu:14.14},{min:14,max:14,pu:13.86},{min:15,max:15,pu:13.58},{min:16,max:16,pu:13.30},
      {min:17,max:17,pu:12.88},{min:18,max:18,pu:12.60},{min:19,max:19,pu:12.32},
      {min:20,max:99999,pu:12.04}
    ],
    'A2': [
      {min:1,max:1,pu:9.80},{min:2,max:2,pu:9.52},{min:3,max:3,pu:9.10},{min:4,max:4,pu:8.61},
      {min:5,max:5,pu:8.47},{min:6,max:6,pu:8.26},{min:7,max:7,pu:8.12},{min:8,max:8,pu:7.91},
      {min:9,max:9,pu:7.70},{min:10,max:10,pu:7.56},{min:11,max:11,pu:7.42},{min:12,max:12,pu:7.21},
      {min:13,max:13,pu:7.07},{min:14,max:14,pu:6.93},{min:15,max:15,pu:6.79},{min:16,max:16,pu:6.65},
      {min:17,max:17,pu:6.44},{min:18,max:18,pu:6.30},{min:19,max:19,pu:6.16},
      {min:20,max:29,pu:6.02},{min:30,max:39,pu:5.25},{min:40,max:49,pu:5.25},
      {min:50,max:59,pu:4.60},{min:60,max:69,pu:4.55},{min:70,max:79,pu:4.20},
      {min:80,max:89,pu:3.85},{min:90,max:99,pu:3.50},{min:100,max:99999,pu:3.36}
    ],
    'A3': [
      {min:2,max:3,pu:5.49},{min:4,max:5,pu:5.14},{min:6,max:7,pu:4.87},{min:8,max:9,pu:4.61},
      {min:10,max:11,pu:4.35},{min:12,max:13,pu:4.26},{min:14,max:15,pu:4.28},{min:16,max:17,pu:4.17},
      {min:18,max:19,pu:4.06},{min:20,max:21,pu:3.99},{min:22,max:23,pu:3.90},{min:24,max:25,pu:3.79},
      {min:26,max:27,pu:3.72},{min:28,max:29,pu:3.64},{min:30,max:31,pu:3.57},{min:32,max:33,pu:3.50},
      {min:34,max:35,pu:3.43},{min:36,max:37,pu:3.36},{min:38,max:39,pu:3.23},
      {min:40,max:58,pu:3.15},{min:60,max:78,pu:2.94},{min:80,max:98,pu:2.73},
      {min:100,max:118,pu:2.52},{min:120,max:138,pu:2.31},{min:140,max:158,pu:2.17},
      {min:160,max:178,pu:2.10},{min:180,max:198,pu:1.96},{min:200,max:99999,pu:1.75}
    ],
    'A4': [
      {min:4,max:7,pu:2.86},{min:8,max:11,pu:2.82},{min:12,max:15,pu:2.48},{min:16,max:19,pu:2.35},
      {min:20,max:23,pu:2.27},{min:24,max:27,pu:2.23},{min:28,max:31,pu:2.19},{min:32,max:35,pu:2.14},
      {min:36,max:39,pu:2.08},{min:40,max:43,pu:2.04},{min:44,max:47,pu:1.99},{min:48,max:51,pu:1.91},
      {min:52,max:55,pu:1.90},{min:56,max:59,pu:1.85},{min:60,max:63,pu:1.82},{min:64,max:67,pu:1.79},
      {min:68,max:71,pu:1.75},{min:72,max:75,pu:1.64},{min:76,max:79,pu:1.64},
      {min:80,max:116,pu:1.60},{min:120,max:156,pu:1.51},{min:160,max:196,pu:1.40},
      {min:200,max:236,pu:1.28},{min:240,max:276,pu:1.19},{min:280,max:316,pu:1.12},
      {min:320,max:356,pu:1.09},{min:360,max:396,pu:1.03},{min:400,max:99999,pu:0.91}
    ],
    'A5': [
      {min:8,max:15,pu:1.45},{min:16,max:23,pu:1.38},{min:24,max:31,pu:1.29},{min:32,max:39,pu:1.22},
      {min:40,max:47,pu:1.20},{min:48,max:55,pu:1.16},{min:56,max:63,pu:1.14},{min:64,max:71,pu:1.11},
      {min:72,max:79,pu:1.08},{min:80,max:87,pu:1.05},{min:88,max:95,pu:1.02},{min:96,max:103,pu:0.99},
      {min:104,max:111,pu:0.98},{min:112,max:119,pu:0.95},{min:120,max:127,pu:0.93},
      {min:128,max:135,pu:0.91},{min:136,max:143,pu:0.88},{min:144,max:151,pu:0.86},
      {min:152,max:159,pu:0.86},
      {min:160,max:232,pu:0.81},{min:240,max:312,pu:0.81},{min:320,max:392,pu:0.70},
      {min:400,max:472,pu:0.67},{min:480,max:552,pu:0.63},{min:560,max:632,pu:0.60},
      {min:640,max:712,pu:0.56},{min:720,max:792,pu:0.50},{min:800,max:99999,pu:0.46}
    ],
    'A6': [
      {min:16,max:31,pu:0.77},{min:32,max:47,pu:0.75},{min:48,max:63,pu:0.68},{min:64,max:79,pu:0.64},
      {min:80,max:95,pu:0.63},{min:96,max:111,pu:0.60},{min:112,max:127,pu:0.59},{min:128,max:143,pu:0.56},
      {min:144,max:159,pu:0.55},{min:160,max:175,pu:0.55},{min:176,max:191,pu:0.54},{min:192,max:207,pu:0.52},
      {min:208,max:223,pu:0.51},{min:224,max:239,pu:0.50},{min:240,max:255,pu:0.49},
      {min:256,max:271,pu:0.48},{min:272,max:287,pu:0.46},{min:288,max:303,pu:0.45},
      {min:304,max:319,pu:0.43},
      {min:320,max:464,pu:0.43},{min:480,max:624,pu:0.40},{min:640,max:784,pu:0.33},
      {min:800,max:944,pu:0.30},{min:960,max:1104,pu:0.28},{min:1120,max:1264,pu:0.27},
      {min:1280,max:1424,pu:0.27},{min:1440,max:1584,pu:0.25},{min:1600,max:99999,pu:0.24}
    ]
  },

  // ── UV DTF ──
  'UV DTF': {
    'A2': [
      {min:1,max:1,pu:11.89},{min:2,max:2,pu:11.65},{min:3,max:3,pu:11.51},{min:4,max:4,pu:11.41},
      {min:5,max:5,pu:11.29},{min:6,max:6,pu:11.17},{min:7,max:7,pu:11.05},{min:8,max:8,pu:10.94},
      {min:9,max:9,pu:10.82},
      {min:10,max:19,pu:10.70},{min:20,max:49,pu:9.51},{min:50,max:99999,pu:8.56}
    ],
    'A3': [
      {min:2,max:3,pu:6.43},{min:4,max:5,pu:6.29},{min:6,max:7,pu:6.17},{min:8,max:9,pu:6.03},
      {min:10,max:11,pu:5.91},{min:12,max:13,pu:5.78},{min:14,max:15,pu:5.64},{min:16,max:17,pu:5.51},
      {min:18,max:19,pu:5.48},
      {min:20,max:38,pu:5.45},{min:40,max:98,pu:4.85},{min:100,max:99999,pu:4.66}
    ],
    'A4': [
      {min:4,max:7,pu:3.99},{min:8,max:11,pu:3.82},{min:12,max:15,pu:3.66},{min:16,max:19,pu:3.50},
      {min:20,max:23,pu:3.37},{min:24,max:27,pu:3.34},{min:28,max:31,pu:3.12},{min:32,max:35,pu:3.22},
      {min:36,max:39,pu:3.15},
      {min:40,max:76,pu:3.10},{min:80,max:196,pu:2.99},{min:200,max:99999,pu:2.80}
    ],
    'A5': [
      {min:8,max:15,pu:2.62},{min:16,max:23,pu:2.15},{min:24,max:31,pu:2.05},{min:32,max:39,pu:1.96},
      {min:40,max:47,pu:1.88},{min:48,max:55,pu:1.87},{min:56,max:63,pu:1.85},{min:64,max:71,pu:1.82},
      {min:72,max:79,pu:1.75},
      {min:80,max:152,pu:1.73},{min:160,max:392,pu:1.67},{min:400,max:99999,pu:1.63}
    ],
    'A6': [
      {min:16,max:31,pu:1.45},{min:32,max:47,pu:1.18},{min:48,max:63,pu:1.12},{min:64,max:79,pu:1.08},
      {min:80,max:95,pu:1.03},{min:96,max:111,pu:1.03},{min:112,max:127,pu:1.02},{min:128,max:143,pu:1.00},
      {min:144,max:159,pu:0.96},
      {min:160,max:304,pu:0.95},{min:320,max:784,pu:0.92},{min:800,max:99999,pu:0.89}
    ]
  },

  // ── Sérigraphie Quadri ──
  SeriQuadri: {
    'A8': [
      {min:10,max:19,pu:1.32},{min:20,max:29,pu:0.98},{min:30,max:39,pu:0.75},
      {min:40,max:49,pu:0.59},{min:50,max:59,pu:0.55},{min:60,max:69,pu:0.50},
      {min:70,max:79,pu:0.46},{min:80,max:89,pu:0.41},{min:90,max:99,pu:0.40},
      {min:100,max:149,pu:0.39},{min:150,max:199,pu:0.33},{min:200,max:249,pu:0.29},
      {min:250,max:299,pu:0.26},{min:300,max:499,pu:0.20},{min:500,max:999,pu:0.16},
      {min:1000,max:1999,pu:0.15},{min:2000,max:2999,pu:0.14},{min:3000,max:5999,pu:0.13},
      {min:6000,max:9999,pu:0.13},{min:10000,max:20000,pu:0.12}
    ],
    'A7': [
      {min:10,max:19,pu:1.71},{min:20,max:29,pu:1.22},{min:30,max:39,pu:1.06},
      {min:40,max:49,pu:0.88},{min:50,max:59,pu:0.83},{min:60,max:69,pu:0.75},
      {min:70,max:79,pu:0.72},{min:80,max:89,pu:0.67},{min:90,max:99,pu:0.63},
      {min:100,max:149,pu:0.61},{min:150,max:199,pu:0.55},{min:200,max:249,pu:0.45},
      {min:250,max:299,pu:0.40},{min:300,max:499,pu:0.25},{min:500,max:999,pu:0.20},
      {min:1000,max:1999,pu:0.16},{min:2000,max:2999,pu:0.15},{min:3000,max:5999,pu:0.14},
      {min:6000,max:9999,pu:0.14},{min:10000,max:20000,pu:0.13}
    ],
    'A6': [
      {min:10,max:19,pu:2.39},{min:20,max:29,pu:1.85},{min:30,max:39,pu:1.34},
      {min:40,max:49,pu:1.46},{min:50,max:59,pu:1.30},{min:60,max:69,pu:1.20},
      {min:70,max:79,pu:1.18},{min:80,max:89,pu:1.07},{min:90,max:99,pu:0.95},
      {min:100,max:149,pu:0.85},{min:150,max:199,pu:0.66},{min:200,max:249,pu:0.61},
      {min:250,max:299,pu:0.47},{min:300,max:499,pu:0.35},{min:500,max:999,pu:0.26},
      {min:1000,max:1999,pu:0.22},{min:2000,max:2999,pu:0.20},{min:3000,max:5999,pu:0.19},
      {min:6000,max:9999,pu:0.19},{min:10000,max:20000,pu:0.19}
    ],
    'A5': [
      {min:10,max:19,pu:3.60},{min:20,max:29,pu:2.95},{min:30,max:39,pu:2.52},
      {min:40,max:49,pu:2.38},{min:50,max:59,pu:2.23},{min:60,max:69,pu:2.05},
      {min:70,max:79,pu:1.73},{min:80,max:89,pu:1.39},{min:90,max:99,pu:1.34},
      {min:100,max:149,pu:1.28},{min:150,max:199,pu:0.81},{min:200,max:249,pu:0.73},
      {min:250,max:299,pu:0.67},{min:300,max:499,pu:0.57},{min:500,max:999,pu:0.40},
      {min:1000,max:1999,pu:0.35},{min:2000,max:2999,pu:0.33},{min:3000,max:5999,pu:0.31},
      {min:6000,max:9999,pu:0.29},{min:10000,max:20000,pu:0.29}
    ],
    'A4': [
      {min:10,max:19,pu:5.75},{min:20,max:29,pu:5.01},{min:30,max:39,pu:4.29},
      {min:40,max:49,pu:3.82},{min:50,max:59,pu:2.69},{min:60,max:69,pu:2.57},
      {min:70,max:79,pu:1.99},{min:80,max:89,pu:1.71},{min:90,max:99,pu:1.63},
      {min:100,max:149,pu:1.54},{min:150,max:199,pu:1.32},{min:200,max:249,pu:1.21},
      {min:250,max:299,pu:1.17},{min:300,max:499,pu:0.94},{min:500,max:999,pu:0.66},
      {min:1000,max:1999,pu:0.55},{min:2000,max:2999,pu:0.52},{min:3000,max:5999,pu:0.49},
      {min:6000,max:9999,pu:0.47},{min:10000,max:20000,pu:0.47}
    ],
    'A3': [
      {min:10,max:19,pu:5.75},{min:20,max:29,pu:5.01},{min:30,max:39,pu:4.29},
      {min:40,max:49,pu:3.59},{min:50,max:59,pu:3.24},{min:60,max:69,pu:3.01},
      {min:70,max:79,pu:2.89},{min:80,max:89,pu:2.77},{min:90,max:99,pu:2.66},
      {min:100,max:149,pu:2.31},{min:150,max:199,pu:2.31},{min:200,max:249,pu:2.19},
      {min:250,max:299,pu:2.03},{min:300,max:499,pu:1.58},{min:500,max:999,pu:1.11},
      {min:1000,max:1999,pu:0.94},{min:2000,max:2999,pu:0.90},{min:3000,max:5999,pu:0.82},
      {min:6000,max:9999,pu:0.81},{min:10000,max:20000,pu:0.81}
    ],
    'A2': [
      {min:10,max:19,pu:9.78},{min:20,max:29,pu:6.14},{min:30,max:39,pu:9.25},
      {min:40,max:49,pu:7.18},{min:50,max:59,pu:6.49},{min:60,max:69,pu:6.04},
      {min:70,max:79,pu:5.79},{min:80,max:89,pu:5.54},{min:90,max:99,pu:5.34},
      {min:100,max:149,pu:5.09},{min:150,max:199,pu:4.63},{min:200,max:249,pu:4.39},
      {min:250,max:299,pu:4.06},{min:300,max:499,pu:3.17},{min:500,max:999,pu:2.22},
      {min:1000,max:1999,pu:1.87},{min:2000,max:2999,pu:1.79},{min:3000,max:5999,pu:1.65},
      {min:6000,max:9999,pu:1.61},{min:10000,max:20000,pu:1.61}
    ]
  },

  // ── Sérigraphie Light ──
  SeriLight: {
    'A8': [
      {min:10,max:19,pu:1.16},{min:20,max:29,pu:0.77},{min:30,max:39,pu:0.60},
      {min:40,max:49,pu:0.67},{min:50,max:59,pu:0.64},{min:60,max:69,pu:0.39},
      {min:70,max:79,pu:0.37},{min:80,max:89,pu:0.34},{min:90,max:99,pu:0.33},
      {min:100,max:149,pu:0.32},{min:150,max:199,pu:0.27},{min:200,max:249,pu:0.25},
      {min:250,max:299,pu:0.23},{min:300,max:499,pu:0.16},{min:500,max:999,pu:0.14},
      {min:1000,max:2999,pu:0.13},{min:3000,max:5999,pu:0.12},
      {min:6000,max:9999,pu:0.11},{min:10000,max:20000,pu:0.09}
    ],
    'A7': [
      {min:10,max:19,pu:1.51},{min:20,max:29,pu:0.98},{min:30,max:39,pu:0.84},
      {min:40,max:49,pu:0.71},{min:50,max:59,pu:0.66},{min:60,max:69,pu:0.60},
      {min:70,max:79,pu:0.58},{min:80,max:89,pu:0.53},{min:90,max:99,pu:0.51},
      {min:100,max:149,pu:0.49},{min:150,max:199,pu:0.47},{min:200,max:249,pu:0.39},
      {min:250,max:299,pu:0.36},{min:300,max:499,pu:0.22},{min:500,max:999,pu:0.17},
      {min:1000,max:2999,pu:0.14},{min:3000,max:5999,pu:0.13},
      {min:6000,max:9999,pu:0.12},{min:10000,max:20000,pu:0.11}
    ],
    'A6': [
      {min:10,max:19,pu:2.11},{min:20,max:29,pu:1.47},{min:30,max:39,pu:1.27},
      {min:40,max:49,pu:1.12},{min:50,max:59,pu:1.04},{min:60,max:69,pu:0.96},
      {min:70,max:79,pu:0.94},{min:80,max:89,pu:0.84},{min:90,max:99,pu:0.76},
      {min:100,max:149,pu:0.69},{min:150,max:199,pu:0.58},{min:200,max:249,pu:0.51},
      {min:250,max:299,pu:0.41},{min:300,max:499,pu:0.31},{min:500,max:999,pu:0.23},
      {min:1000,max:2999,pu:0.20},{min:3000,max:5999,pu:0.17},
      {min:6000,max:9999,pu:0.14},{min:10000,max:20000,pu:0.14}
    ],
    'A5': [
      {min:10,max:19,pu:3.17},{min:20,max:29,pu:2.36},{min:30,max:39,pu:2.01},
      {min:40,max:49,pu:1.91},{min:50,max:59,pu:1.78},{min:60,max:69,pu:1.65},
      {min:70,max:79,pu:1.38},{min:80,max:89,pu:1.11},{min:90,max:99,pu:1.08},
      {min:100,max:149,pu:1.02},{min:150,max:199,pu:0.71},{min:200,max:249,pu:0.63},
      {min:250,max:299,pu:0.59},{min:300,max:499,pu:0.50},{min:500,max:999,pu:0.36},
      {min:1000,max:2999,pu:0.29},{min:3000,max:5999,pu:0.27},
      {min:6000,max:9999,pu:0.26},{min:10000,max:20000,pu:0.25}
    ],
    'A4': [
      {min:10,max:19,pu:5.06},{min:20,max:29,pu:4.01},{min:30,max:39,pu:3.44},
      {min:40,max:49,pu:2.33},{min:50,max:59,pu:2.15},{min:60,max:69,pu:1.90},
      {min:70,max:79,pu:1.59},{min:80,max:89,pu:1.36},{min:90,max:99,pu:1.31},
      {min:100,max:149,pu:1.22},{min:150,max:199,pu:1.16},{min:200,max:249,pu:1.07},
      {min:250,max:299,pu:1.02},{min:300,max:499,pu:0.82},{min:500,max:999,pu:0.58},
      {min:1000,max:2999,pu:0.46},{min:3000,max:5999,pu:0.43},
      {min:6000,max:9999,pu:0.41},{min:10000,max:20000,pu:0.41}
    ],
    'A3': [
      {min:10,max:19,pu:5.06},{min:20,max:29,pu:4.01},{min:30,max:39,pu:3.44},
      {min:40,max:49,pu:2.87},{min:50,max:59,pu:2.59},{min:60,max:69,pu:2.40},
      {min:70,max:79,pu:2.31},{min:80,max:89,pu:2.23},{min:90,max:99,pu:2.13},
      {min:100,max:149,pu:2.04},{min:150,max:199,pu:2.01},{min:200,max:249,pu:1.93},
      {min:250,max:299,pu:1.78},{min:300,max:499,pu:1.39},{min:500,max:999,pu:0.97},
      {min:1000,max:2999,pu:0.79},{min:3000,max:5999,pu:0.78},
      {min:6000,max:9999,pu:0.72},{min:10000,max:20000,pu:0.71}
    ],
    'A2': [
      {min:10,max:19,pu:8.61},{min:20,max:29,pu:4.90},{min:30,max:39,pu:3.99},
      {min:40,max:49,pu:3.84},{min:50,max:59,pu:3.84},{min:60,max:69,pu:3.70},
      {min:70,max:79,pu:3.63},{min:80,max:89,pu:3.46},{min:90,max:99,pu:3.39},
      {min:100,max:149,pu:3.35},{min:150,max:199,pu:3.24},{min:200,max:249,pu:3.17},
      {min:250,max:299,pu:2.77},{min:300,max:499,pu:2.34},{min:500,max:999,pu:1.51},
      {min:1000,max:2999,pu:1.33},{min:3000,max:5999,pu:1.26},
      {min:6000,max:9999,pu:1.09},{min:10000,max:20000,pu:1.04}
    ]
  }
};
