export const animals = [
  ['Fox', '🦊'], ['Cat', '🐱'], ['Dog', '🐶'], ['Bear', '🐻'],
  ['Panda', '🐼'], ['Koala', '🐨'], ['Tiger', '🐯'], ['Lion', '🦁'],
  ['Rabbit', '🐰'], ['Mouse', '🐭'], ['Frog', '🐸'], ['Penguin', '🐧'],
  ['Owl', '🦉'], ['Duck', '🦆'], ['Butterfly', '🦋'], ['Turtle', '🐢'],
  ['Octopus', '🐙'], ['Whale', '🐳'], ['Dolphin', '🐬'], ['Unicorn', '🦄'],
];

export const colors = [
  ['Red', '#ef9a9a'], ['Orange', '#ffcc80'], ['Yellow', '#fff59d'],
  ['Green', '#a5d6a7'], ['Blue', '#90caf9'], ['Purple', '#ce93d8'],
  ['Pink', '#f48fb1'], ['Teal', '#80cbc4'], ['Cyan', '#80deea'],
  ['Indigo', '#9fa8da'], ['Violet', '#b39ddb'], ['Coral', '#ffab91'],
  ['Gold', '#ffe082'], ['Silver', '#cfd8dc'], ['Mint', '#b9f6ca'],
  ['Olive', '#d4e157'], ['Peach', '#ffdab9'], ['Lavender', '#e1bee7'],
  ['Crimson', '#e57373'], ['Turquoise', '#64d8cb'],
];

export function profileForName(name) {
  const [colorName, animalName, extra] = name.split(/[ _-]+/);
  if (extra) return null;
  const color = colors.find(([label]) => label.toLowerCase() === colorName?.toLowerCase());
  const animal = animals.find(([label]) => label.toLowerCase() === animalName?.toLowerCase());
  return color && animal ? { name: `${color[0]} ${animal[0]}`, color: color[1], emoji: animal[1] } : null;
}
