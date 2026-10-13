// Montana-flavoured names. The world is procedural, not a map of Montana: real place names are
// used as flavour only (populations, layouts and distances are invented).
import { prng } from './noise.js';

export const CITY_NAMES = ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Butte', 'Helena', 'Kalispell', 'Havre', 'Anaconda', 'Miles City', 'Livingston', 'Laurel',
  'Whitefish', 'Lewistown', 'Sidney', 'Glendive', 'Dillon', 'Hamilton', 'Polson', 'Belgrade', 'Columbia Falls', 'Cut Bank', 'Shelby', 'Glasgow', 'Wolf Point'];

export const TOWN_NAMES = ['Red Lodge', 'Big Timber', 'Ennis', 'Choteau', 'Conrad', 'Fort Benton', 'Harlowton', 'Roundup', 'Hardin', 'Forsyth', 'Malta', 'Chinook', 'Townsend',
  'Whitehall', 'Deer Lodge', 'Philipsburg', 'Darby', 'Stevensville', 'Thompson Falls', 'Libby', 'Eureka', 'Cooke City', 'West Yellowstone', 'Gardiner', 'Virginia City',
  'Boulder', 'Three Forks', 'Manhattan', 'Columbus', 'Absarokee', 'Terry', 'Baker', 'Plentywood', 'Scobey', 'Circle', 'Jordan', 'Winnett', 'Stanford', 'Geraldine', 'Browning',
  'East Glacier', 'Seeley Lake', 'Ronan', 'Plains', 'Superior', 'Lincoln', 'Augusta', 'Fairfield', 'Dutton', 'Cascade', 'Wilsall', 'Reed Point', 'Judith Gap', 'Ekalaka',
  'Broadus', 'Ashland', 'Lame Deer', 'Crow Agency', 'Hot Springs', 'Troy', 'Bigfork', 'Lakeside', 'Somers', 'Hungry Horse', 'West Glacier', 'Twin Bridges', 'Sheridan',
  'Cardwell', 'Pony', 'Emigrant', 'Silver Star', 'Wisdom', 'Jackson', 'Lima', 'Dell', 'Alder', 'Melrose', 'Divide', 'Basin', 'Clancy', 'Montana City', 'Elk Park'];

const A = ['Antelope', 'Badger', 'Bear', 'Beaver', 'Big', 'Bitterroot', 'Bison', 'Buffalo', 'Cottonwood', 'Coyote', 'Eagle', 'Elk', 'Fox', 'Grizzly', 'Hawk', 'Lone', 'Moose',
  'Otter', 'Prairie', 'Rattlesnake', 'Sage', 'Sheep', 'Silver', 'Sun', 'Wolf', 'Copper', 'Iron', 'Antler', 'Cedar', 'Cinnabar', 'Dry', 'Little', 'Painted', 'Red', 'Willow'];
const B = ['Butte', 'Creek', 'Crossing', 'Flats', 'Gulch', 'Junction', 'Meadow', 'Mill', 'Pass', 'Ridge', 'Springs', 'Wells', 'Bench', 'Basin', 'Bluff', 'Coulee', 'Prairie',
  'Bend', 'Fork', 'Hollow', 'Landing', 'Rock', 'Siding', 'Camp'];

export function makeName(seed) {
  const r = prng(seed);
  return `${A[Math.floor(r() * A.length)]} ${B[Math.floor(r() * B.length)]}`;
}

export const STREETS = ['Front', 'Custer', 'Lewis', 'Clark', 'Sacajawea', 'Bitterroot', 'Cottonwood', 'Aspen', 'Pine', 'Spruce', 'Mountain View', 'Railroad', 'Elk', 'Bison',
  'Montana', 'Big Sky', 'Yellowstone', 'Missouri', 'Flathead', 'Madison', 'Gallatin', 'Jefferson', 'Park', 'Lincoln', 'Washington', 'Grant', 'Sheridan', 'Chestnut', 'Cedar',
  'Mill', 'Depot', 'Church', 'School', 'Bridge', 'Ranch', 'Copper', 'Silver', 'Prospect', 'Valley', 'Ridge'];

export const BUSINESSES = ['Big Sky Diner', 'Huckleberry Cafe', 'Cowboy Bar & Grill', 'Sage Motel', 'Pronghorn Outfitters', 'Prairie Grocery', 'Feed & Seed', 'Treasure State Hardware',
  'Bison Burger Co.', 'Rocky Mountain Rafting', 'Glacier Gear', 'Fly Shop', 'Hi-Line Hardware', 'Copper City Pawn', 'Moose Lodge', 'Lone Pine Saloon', 'Antler Gifts',
  'Stockyard Cafe', 'Treasure Pharmacy', 'Rustic Hardware', 'Grain & Grill', 'Elkhorn Mercantile', 'Trailhead Bakery', 'Montana Mud Brewery', 'Chokecherry Bakery'];

export const SLOGANS = ['BIG SKY. BIGGER BURGERS.', 'HUCKLEBERRY PIE — NEXT EXIT', 'LAST GAS FOR 60 MILES', 'FRESH-CAUGHT TROUT · EAT HERE', 'DON\'T TAILGATE THE ELK',
  'WORLD\'S OKAYEST BISON JERKY', 'FLY FISHING GUIDES · RIGHT LANE', 'FREE ICE WATER · WELCOME HIKERS', 'HOT SHOWERS · HOT COFFEE', 'YOU ARE HERE. NOBODY ELSE IS.',
  'SPEED LIMIT SUGGESTION: SLOWER', 'CATTLE CROSSING · MOO-VE OVER', 'WI-FI: LOOK AT THE VIEW', 'NEXT SERVICES: ASK THE HORSES'];

export const WELCOME = ['Welcome to', 'Welcome to', 'Welcome to', 'Visit', 'Home of the', 'You are entering'];
