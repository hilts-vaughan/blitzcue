import { animals, colors, profileForName } from './standalone-profile.js';

const storageKey = 'blitzcue.standalone.profile';
const colorSelect = document.querySelector('#profile-color');
const animalSelect = document.querySelector('#profile-animal');
for (const [label] of colors) colorSelect.add(new Option(label, label));
for (const [label] of animals) animalSelect.add(new Option(label, label));

let saved;
try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch { /* Storage may be unavailable. */ }
const playerId = /^[a-f0-9]{24}$/.test(saved?.id || '')
  ? saved.id
  : Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');
document.querySelector('#player-id').value = playerId;

function updateProfile() {
  const profile = profileForName(`${colorSelect.value} ${animalSelect.value}`);
  document.querySelector('#player-name').value = profile.name;
  document.querySelector('#profile-name').textContent = profile.name;
  const avatar = document.querySelector('#profile-avatar');
  avatar.textContent = profile.emoji;
  avatar.style.backgroundColor = profile.color;
  try { localStorage.setItem(storageKey, JSON.stringify({ id: playerId, name: profile.name })); } catch { /* Play still works without persistence. */ }
}

function shuffle() {
  const combinations = colors.length * animals.length;
  const current = colors.findIndex(([name]) => name === colorSelect.value) * animals.length
    + animals.findIndex(([name]) => name === animalSelect.value);
  const choice = (current + 1 + Math.floor(Math.random() * (combinations - 1))) % combinations;
  colorSelect.value = colors[Math.floor(choice / animals.length)][0];
  animalSelect.value = animals[choice % animals.length][0];
  updateProfile();
}

const restored = profileForName(typeof saved?.name === 'string' ? saved.name : '');
if (restored) {
  [colorSelect.value, animalSelect.value] = restored.name.split(' ');
  updateProfile();
} else {
  shuffle();
}
colorSelect.addEventListener('change', updateProfile);
animalSelect.addEventListener('change', updateProfile);
document.querySelector('#shuffle-name').addEventListener('click', shuffle);
document.querySelector('#launch-form').addEventListener('submit', updateProfile);
document.querySelector('#play-button').disabled = false;
