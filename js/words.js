// words.js — built-in word bank by difficulty tier.
// Easy: concrete, common single nouns.
// Medium: compound nouns, mild abstractions, recognizable objects.
// Hard: abstract concepts, multi-word phrases, things that resist simple drawing.

const WORD_BANK = {
  easy: [
    'apple', 'banana', 'cat', 'dog', 'sun', 'moon', 'star', 'tree', 'flower', 'house',
    'car', 'bus', 'train', 'plane', 'boat', 'fish', 'bird', 'duck', 'cow', 'pig',
    'horse', 'sheep', 'bear', 'lion', 'tiger', 'elephant', 'snake', 'frog', 'spider', 'bee',
    'cake', 'pizza', 'burger', 'egg', 'cheese', 'bread', 'milk', 'water', 'cup', 'plate',
    'spoon', 'fork', 'knife', 'chair', 'table', 'bed', 'door', 'window', 'key', 'book',
    'pen', 'pencil', 'phone', 'clock', 'shoe', 'sock', 'hat', 'shirt', 'pants', 'glove',
    'eye', 'ear', 'nose', 'mouth', 'hand', 'foot', 'ball', 'kite', 'drum', 'guitar',
    'cloud', 'rain', 'snow', 'fire', 'leaf', 'mountain', 'river', 'beach', 'island', 'rock',
    'rainbow', 'umbrella', 'balloon', 'gift', 'candle', 'crown', 'heart', 'smile', 'tooth', 'finger',
  ],
  medium: [
    'pirate', 'astronaut', 'volcano', 'lighthouse', 'windmill', 'castle', 'dragon', 'unicorn', 'mermaid', 'wizard',
    'skateboard', 'bicycle', 'helicopter', 'submarine', 'roller coaster', 'ferris wheel', 'snowman', 'scarecrow', 'campfire', 'tent',
    'jellyfish', 'octopus', 'kangaroo', 'penguin', 'butterfly', 'dolphin', 'panda', 'flamingo', 'hedgehog', 'owl',
    'cactus', 'sunflower', 'mushroom', 'pineapple', 'watermelon', 'strawberry', 'avocado', 'broccoli', 'donut', 'sandwich',
    'microphone', 'binoculars', 'telescope', 'compass', 'globe', 'map', 'treasure', 'shipwreck', 'spaceship', 'satellite',
    'piano', 'violin', 'trumpet', 'saxophone', 'headphones', 'sneakers', 'sunglasses', 'backpack', 'wallet', 'envelope',
    'detective', 'chef', 'farmer', 'doctor', 'firefighter', 'mailman', 'magician', 'cowboy', 'ninja', 'robot',
    'thunderstorm', 'tornado', 'avalanche', 'desert', 'jungle', 'glacier', 'cave', 'canyon', 'waterfall', 'forest',
    'wedding', 'birthday', 'parade', 'fireworks', 'graduation', 'olympics', 'circus', 'museum', 'library', 'aquarium',
  ],
  hard: [
    'nostalgia', 'gravity', 'democracy', 'inflation', 'philosophy', 'imagination', 'patience', 'ambition', 'jealousy', 'freedom',
    'time travel', 'parallel universe', 'black hole', 'quantum', 'singularity', 'big bang', 'evolution', 'photosynthesis', 'gravity well', 'time loop',
    'pandemic', 'recession', 'election', 'revolution', 'protest', 'diplomacy', 'monarchy', 'bureaucracy', 'globalization', 'capitalism',
    'midnight snack', 'awkward silence', 'identity crisis', 'writers block', 'sleep paralysis', 'déjà vu', 'imposter syndrome', 'fear of missing out', 'paradox', 'serendipity',
    'cryptocurrency', 'artificial intelligence', 'machine learning', 'open source', 'social media', 'cancel culture', 'echo chamber', 'algorithm', 'pixel', 'firewall',
    'mona lisa', 'last supper', 'starry night', 'pyramids', 'great wall', 'eiffel tower', 'colosseum', 'taj mahal', 'stonehenge', 'mount rushmore',
    'shakespeare', 'einstein', 'da vinci', 'cleopatra', 'napoleon', 'mozart', 'beethoven', 'picasso', 'gandhi', 'mandela',
    'metamorphosis', 'symbiosis', 'camouflage', 'hibernation', 'migration', 'extinction', 'mutation', 'ecosystem', 'food chain', 'natural selection',
    'rubber duck debugging', 'spaghetti code', 'kitchen sink', 'piece of cake', 'cold feet', 'butterfly effect', 'tip of the iceberg', 'breaking the ice', 'spilling the beans', 'on cloud nine',
  ],
};

function buildWordPool(difficulty, customWords) {
  let pool = [];
  if (difficulty === 'mixed') {
    pool = [...WORD_BANK.easy, ...WORD_BANK.medium, ...WORD_BANK.hard];
  } else {
    pool = [...(WORD_BANK[difficulty] || WORD_BANK.medium)];
  }
  if (Array.isArray(customWords)) {
    for (const w of customWords) {
      const clean = String(w || '').trim();
      if (clean) pool.push(clean);
    }
  }
  return pool;
}

function pickThreeWords(pool, used) {
  const available = pool.filter(w => !used.has(w));
  const source = available.length >= 3 ? available : pool;
  const chosen = new Set();
  const result = [];
  let safety = 0;
  while (result.length < 3 && safety < 200) {
    const w = source[Math.floor(Math.random() * source.length)];
    if (!chosen.has(w)) {
      chosen.add(w);
      result.push(w);
    }
    safety++;
  }
  while (result.length < 3) {
    result.push(source[Math.floor(Math.random() * source.length)] || 'apple');
  }
  return result;
}
