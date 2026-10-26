import type { Movement } from './catalogue';

/**
 * Seed exercise catalogue: flat records, one per variant, grouped by family for readability. A family head is a real
 * movement whose plain name workouts use ("Cleans", "Pull-ups"); only "Squats", "Overhead presses" and "Dips" are
 * umbrella heads because no plain name exists. Loads are left to settings; `notes` only where a standard matters.
 */
export const seedMovements: Movement[] = [
  // Cleans
  { id: 'clean', name: 'Cleans', aliases: ['Clean', 'Barbell cleans'], equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'power-clean', name: 'Power cleans', family: 'clean', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'hang-clean', name: 'Hang cleans', family: 'clean', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'hang-power-clean', name: 'Hang power cleans', family: 'clean', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'squat-clean', name: 'Squat cleans', family: 'clean', equipment: ['Barbell'], category: 'weightlifting', notes: 'Full clean received in the bottom of the squat' },
  { id: 'hang-squat-clean', name: 'Hang squat cleans', family: 'clean', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'clean-and-jerk', name: 'Clean and jerks', aliases: ['Clean & jerks', 'C&J', 'Clean and jerk', 'Clean & jerk'], family: 'clean', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'dumbbell-clean', name: 'Dumbbell cleans', aliases: ['DB cleans', 'Double dumbbell cleans'], family: 'clean', equipment: ['Dumbbells'], category: 'weightlifting' },
  { id: 'dumbbell-hang-clean', name: 'Dumbbell hang cleans', shortName: 'DB hang cleans', aliases: ['DB hang cleans', 'Hang dumbbell cleans'], family: 'clean', equipment: ['Dumbbells'], category: 'weightlifting' },
  { id: 'dumbbell-power-clean', name: 'Dumbbell power cleans', shortName: 'DB power cleans', aliases: ['DB power cleans'], family: 'clean', equipment: ['Dumbbells'], category: 'weightlifting' },
  { id: 'single-dumbbell-clean', name: 'Single-dumbbell cleans', shortName: 'Single DB cleans', aliases: ['Single DB cleans', 'Single-arm dumbbell cleans', 'One-arm dumbbell cleans'], family: 'clean', equipment: ['Dumbbells'], category: 'weightlifting' },
  { id: 'double-dumbbell-clean-and-jerk', name: 'Double dumbbell clean and jerks', shortName: 'DB clean & jerks', aliases: ['Dumbbell clean and jerks', 'DB clean and jerks', 'DB clean & jerks', 'Double DB clean & jerks'], family: 'clean', equipment: ['Dumbbells'], category: 'weightlifting' },
  { id: 'single-dumbbell-clean-and-jerk', name: 'Single-dumbbell clean and jerks', shortName: 'Single DB clean & jerks', aliases: ['Single DB clean and jerks', 'Single-arm dumbbell clean and jerks', 'One-arm dumbbell clean and jerks'], family: 'clean', equipment: ['Dumbbells'], category: 'weightlifting' },
  { id: 'kettlebell-clean', name: 'Kettlebell cleans', aliases: ['KB cleans'], family: 'clean', equipment: ['Kettlebell'], category: 'weightlifting' },
  { id: 'sandbag-clean', name: 'Sandbag cleans', aliases: ['Sandbag cleans to shoulder'], family: 'clean', equipment: ['Sandbag'], category: 'conditioning' },
  { id: 'medicine-ball-clean', name: 'Medicine ball cleans', aliases: ['Med ball cleans', 'Wall ball cleans'], family: 'clean', equipment: ['Medicine ball'], category: 'conditioning' },

  // Snatches
  { id: 'snatch', name: 'Snatches', aliases: ['Snatch', 'Barbell snatches'], equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'power-snatch', name: 'Power snatches', family: 'snatch', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'squat-snatch', name: 'Squat snatches', family: 'snatch', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'hang-snatch', name: 'Hang snatches', family: 'snatch', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'hang-power-snatch', name: 'Hang power snatches', family: 'snatch', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'dumbbell-snatch', name: 'Dumbbell snatches', aliases: ['DB snatches', 'Alternating dumbbell snatches', 'Single-arm dumbbell snatches'], family: 'snatch', equipment: ['Dumbbells'], category: 'weightlifting' },
  { id: 'kettlebell-snatch', name: 'Kettlebell snatches', aliases: ['KB snatches'], family: 'snatch', equipment: ['Kettlebell'], category: 'weightlifting' },

  // Overhead presses (umbrella head)
  { id: 'press', name: 'Overhead presses', aliases: ['Overhead press', 'Presses'], equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'shoulder-press', name: 'Shoulder press', aliases: ['Strict press', 'Military press', 'Barbell shoulder press'], family: 'press', equipment: ['Barbell'], category: 'strength' },
  { id: 'push-press', name: 'Push presses', aliases: ['Barbell push presses'], family: 'press', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'push-jerk', name: 'Push jerks', aliases: ['Jerks'], family: 'press', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'split-jerk', name: 'Split jerks', family: 'press', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'shoulder-to-overhead', name: 'Shoulder-to-overhead', aliases: ['STOH', 'S2OH', 'Shoulder to overhead'], family: 'press', equipment: ['Barbell'], category: 'weightlifting', notes: 'Any style: strict, push press or jerk' },
  { id: 'dumbbell-shoulder-press', name: 'Dumbbell shoulder press', shortName: 'DB shoulder press', aliases: ['DB shoulder press', 'DB strict press', 'Dumbbell strict press'], family: 'press', equipment: ['Dumbbells'], category: 'strength' },
  { id: 'dumbbell-push-press', name: 'Dumbbell push presses', shortName: 'DB push presses', aliases: ['DB push presses'], family: 'press', equipment: ['Dumbbells'], category: 'weightlifting' },
  { id: 'dumbbell-shoulder-to-overhead', name: 'Dumbbell shoulder-to-overhead', shortName: 'DB STOH', aliases: ['DB shoulder-to-overhead', 'DB STOH', 'DB S2OH'], family: 'press', equipment: ['Dumbbells'], category: 'weightlifting' },
  { id: 'kettlebell-press', name: 'Kettlebell press', aliases: ['KB press', 'Kettlebell strict press'], family: 'press', equipment: ['Kettlebell'], category: 'strength' },

  // Squats (umbrella head)
  { id: 'squat', name: 'Squats', aliases: ['Squat'], category: 'strength' },
  { id: 'air-squat', name: 'Air squats', aliases: ['Bodyweight squats'], family: 'squat', category: 'conditioning' },
  { id: 'air-squat-to-plate', name: 'Air squats to a plate', shortName: 'Squats to plate', aliases: ['Squats to a plate', 'Squats to plate'], family: 'squat', equipment: ['Weight plate'], category: 'conditioning', notes: 'Squat until you touch a plate on the floor; sets depth' },
  { id: 'back-squat', name: 'Back squat', aliases: ['Barbell back squats'], family: 'squat', equipment: ['Barbell'], category: 'strength' },
  { id: 'front-squat', name: 'Front squats', aliases: ['Barbell front squats'], family: 'squat', equipment: ['Barbell'], category: 'strength' },
  { id: 'pause-front-squat', name: 'Pause front squat', aliases: ['Paused front squats', 'Tempo front squats'], family: 'squat', equipment: ['Barbell'], category: 'strength' },
  { id: 'overhead-squat', name: 'Overhead squats', aliases: ['OHS'], family: 'squat', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'goblet-squat', name: 'Goblet squats', aliases: ['Kettlebell goblet squats', 'KB goblet squats', 'Dumbbell goblet squats'], family: 'squat', equipment: ['Kettlebell'], category: 'strength', notes: 'A kettlebell or a dumbbell held at the chest' },
  { id: 'dumbbell-front-squat', name: 'Dumbbell front squats', shortName: 'DB front squats', aliases: ['DB front squats'], family: 'squat', equipment: ['Dumbbells'], category: 'strength' },
  { id: 'jump-squat', name: 'Jump squats', aliases: ['Squat jumps'], family: 'squat', category: 'conditioning' },
  { id: 'pistol', name: 'Pistols', aliases: ['Pistol squats', 'Single-leg squats', 'One-legged squats'], family: 'squat', category: 'gymnastics' },

  // Deadlifts
  { id: 'deadlift', name: 'Deadlifts', aliases: ['DL', 'Barbell deadlifts'], equipment: ['Barbell'], category: 'strength' },
  { id: 'romanian-deadlift', name: 'Romanian deadlifts', aliases: ['RDL', 'RDLs'], family: 'deadlift', equipment: ['Barbell'], category: 'strength' },
  { id: 'sumo-deadlift', name: 'Sumo deadlifts', family: 'deadlift', equipment: ['Barbell'], category: 'strength' },
  { id: 'sumo-deadlift-high-pull', name: 'Sumo deadlift high pulls', shortName: 'SDHP', aliases: ['SDHP', 'Sumo deadlift high-pulls'], family: 'deadlift', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'dumbbell-deadlift', name: 'Dumbbell deadlifts', aliases: ['DB deadlifts'], family: 'deadlift', equipment: ['Dumbbells'], category: 'strength' },
  { id: 'dumbbell-romanian-deadlift', name: 'Dumbbell Romanian deadlifts', shortName: 'DB RDLs', aliases: ['DB RDLs', 'DB Romanian deadlifts'], family: 'deadlift', equipment: ['Dumbbells'], category: 'strength' },
  { id: 'kettlebell-deadlift', name: 'Kettlebell deadlifts', aliases: ['KB deadlifts'], family: 'deadlift', equipment: ['Kettlebell'], category: 'strength' },

  // Bench press
  { id: 'bench-press', name: 'Bench press', aliases: ['Barbell bench press', 'Bench'], equipment: ['Barbell', 'Bench'], category: 'strength' },
  { id: 'dumbbell-bench-press', name: 'Dumbbell bench press', shortName: 'DB bench press', aliases: ['DB bench press'], family: 'bench-press', equipment: ['Dumbbells', 'Bench'], category: 'strength' },
  { id: 'floor-press', name: 'Floor press', aliases: ['Dumbbell floor press', 'DB floor press'], family: 'bench-press', equipment: ['Dumbbells'], category: 'strength' },

  // Thrusters
  { id: 'thruster', name: 'Thrusters', aliases: ['Thruster', 'Barbell thrusters'], equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'dumbbell-thruster', name: 'Dumbbell thrusters', aliases: ['DB thrusters', 'Double dumbbell thrusters'], family: 'thruster', equipment: ['Dumbbells'], category: 'weightlifting' },
  { id: 'single-dumbbell-thruster', name: 'Single-dumbbell thrusters', shortName: 'Single DB thrusters', aliases: ['Single DB thrusters', 'Single-arm dumbbell thrusters', 'One-arm dumbbell thrusters'], family: 'thruster', equipment: ['Dumbbells'], category: 'weightlifting' },
  { id: 'kettlebell-thruster', name: 'Kettlebell thrusters', aliases: ['KB thrusters'], family: 'thruster', equipment: ['Kettlebell'], category: 'weightlifting' },

  // Balls
  { id: 'wall-ball', name: 'Wall balls', aliases: ['Wall-ball shots', 'Wall ball shots', 'WB', 'Wallballs', 'Wall-balls'], equipment: ['Medicine ball'], category: 'conditioning', notes: '10 ft men / 9 ft women target; 20 lb / 14 lb ball' },
  { id: 'slam-ball', name: 'Slam balls', aliases: ['Ball slams', 'Slam ball slams', 'Medicine ball slams'], equipment: ['Slam ball'], category: 'conditioning' },
  { id: 'slam-ball-ground-to-overhead', name: 'Slam ball ground-to-overhead', shortName: 'Slam ball G2OH', aliases: ['Slam ball G2OH', 'Slam ball ground to overhead'], family: 'slam-ball', equipment: ['Slam ball'], category: 'conditioning' },

  // Kettlebell swings
  { id: 'kettlebell-swing', name: 'Kettlebell swings', aliases: ['KB swings', 'KBS'], equipment: ['Kettlebell'], category: 'weightlifting' },
  { id: 'russian-kettlebell-swing', name: 'Russian kettlebell swings', shortName: 'Russian KB swings', aliases: ['Russian KB swings', 'Russian swings'], family: 'kettlebell-swing', equipment: ['Kettlebell'], category: 'weightlifting', notes: 'To eye level' },
  { id: 'american-kettlebell-swing', name: 'American kettlebell swings', shortName: 'American KB swings', aliases: ['American KB swings', 'American swings', 'Overhead kettlebell swings'], family: 'kettlebell-swing', equipment: ['Kettlebell'], category: 'weightlifting', notes: 'Locked out overhead' },
  { id: 'single-arm-kettlebell-swing', name: 'Single-arm kettlebell swings', shortName: 'Single-arm KB swings', aliases: ['Single-arm KB swings', 'One-arm kettlebell swings'], family: 'kettlebell-swing', equipment: ['Kettlebell'], category: 'weightlifting' },

  // Pull-ups
  { id: 'pull-up', name: 'Pull-ups', aliases: ['Pullups', 'Pull up'], equipment: ['Pull-up bar'], category: 'gymnastics' },
  { id: 'strict-pull-up', name: 'Strict pull-ups', family: 'pull-up', equipment: ['Pull-up bar'], category: 'gymnastics' },
  { id: 'kipping-pull-up', name: 'Kipping pull-ups', family: 'pull-up', equipment: ['Pull-up bar'], category: 'gymnastics' },
  { id: 'butterfly-pull-up', name: 'Butterfly pull-ups', family: 'pull-up', equipment: ['Pull-up bar'], category: 'gymnastics' },
  { id: 'chest-to-bar-pull-up', name: 'Chest-to-bar pull-ups', shortName: 'C2B pull-ups', spokenName: 'Chest to bar pull-ups', aliases: ['C2B', 'CTB', 'C2B pull-ups', 'Chest to bar pull-ups', 'Chest-to-bar'], family: 'pull-up', equipment: ['Pull-up bar'], category: 'gymnastics' },
  { id: 'chin-up', name: 'Chin-ups', aliases: ['Chinups'], family: 'pull-up', equipment: ['Pull-up bar'], category: 'gymnastics' },
  { id: 'weighted-pull-up', name: 'Weighted pull-ups', family: 'pull-up', equipment: ['Pull-up bar'], category: 'strength' },
  { id: 'jumping-pull-up', name: 'Jumping pull-ups', family: 'pull-up', equipment: ['Pull-up bar'], category: 'gymnastics' },
  { id: 'ring-row', name: 'Ring rows', aliases: ['Ring row', 'Australian pull-ups'], family: 'pull-up', equipment: ['Rings'], category: 'gymnastics' },
  { id: 'dead-hang', name: 'Dead hang', aliases: ['Bar hang', 'Dead hang hold'], family: 'pull-up', equipment: ['Pull-up bar'], category: 'gymnastics' },

  // Muscle-ups
  { id: 'muscle-up', name: 'Muscle-ups', aliases: ['Ring muscle-ups', 'RMU', 'Muscle ups', 'Ring muscle ups'], equipment: ['Rings'], category: 'gymnastics', notes: 'Ring muscle-ups unless the workout says bar' },
  { id: 'bar-muscle-up', name: 'Bar muscle-ups', aliases: ['BMU', 'Bar muscle ups'], family: 'muscle-up', equipment: ['Pull-up bar'], category: 'gymnastics' },
  { id: 'strict-muscle-up', name: 'Strict muscle-ups', aliases: ['Strict ring muscle-ups'], family: 'muscle-up', equipment: ['Rings'], category: 'gymnastics' },

  // Toes-to-bar
  { id: 'toes-to-bar', name: 'Toes-to-bar', aliases: ['T2B', 'TTB', 'Toes to bar'], equipment: ['Pull-up bar'], category: 'gymnastics' },
  { id: 'knees-to-elbows', name: 'Knees-to-elbows', aliases: ['K2E', 'Knees to elbows'], family: 'toes-to-bar', equipment: ['Pull-up bar'], category: 'gymnastics' },
  { id: 'hanging-knee-raise', name: 'Hanging knee raises', aliases: ['Knee raises', 'Hanging leg raises'], family: 'toes-to-bar', equipment: ['Pull-up bar'], category: 'gymnastics' },

  // Handstands
  { id: 'handstand-push-up', name: 'Handstand push-ups', shortName: 'HSPU', aliases: ['HSPU', 'Handstand pushups'], equipment: ['Wall'], category: 'gymnastics' },
  { id: 'strict-handstand-push-up', name: 'Strict handstand push-ups', shortName: 'Strict HSPU', aliases: ['Strict HSPU'], family: 'handstand-push-up', equipment: ['Wall'], category: 'gymnastics' },
  { id: 'kipping-handstand-push-up', name: 'Kipping handstand push-ups', shortName: 'Kipping HSPU', aliases: ['Kipping HSPU'], family: 'handstand-push-up', equipment: ['Wall'], category: 'gymnastics' },
  { id: 'deficit-handstand-push-up', name: 'Deficit handstand push-ups', shortName: 'Deficit HSPU', aliases: ['Deficit HSPU'], family: 'handstand-push-up', equipment: ['Wall', 'Weight plate'], category: 'gymnastics' },
  { id: 'pike-push-up', name: 'Pike push-ups', aliases: ['Box pike push-ups'], family: 'handstand-push-up', category: 'gymnastics' },
  { id: 'handstand-hold', name: 'Handstand hold', aliases: ['Wall-facing handstand hold', 'Handstand holds'], family: 'handstand-push-up', equipment: ['Wall'], category: 'gymnastics' },
  { id: 'handstand-walk', name: 'Handstand walk', aliases: ['Handstand walking', 'HS walk', 'Handstand walks'], category: 'gymnastics' },
  { id: 'wall-walk', name: 'Wall walks', aliases: ['Wall walk', 'Wall-walks'], equipment: ['Wall'], category: 'gymnastics' },

  // Push-ups
  { id: 'push-up', name: 'Push-ups', aliases: ['Pushups', 'Press-ups'], category: 'gymnastics' },
  { id: 'hand-release-push-up', name: 'Hand-release push-ups', shortName: 'HR push-ups', aliases: ['HR push-ups', 'Hand release push-ups', 'HRPU'], family: 'push-up', category: 'gymnastics' },
  { id: 'knee-push-up', name: 'Knee push-ups', aliases: ['Push-ups from knees', 'Kneeling push-ups'], family: 'push-up', category: 'gymnastics' },
  { id: 'ring-push-up', name: 'Ring push-ups', family: 'push-up', equipment: ['Rings'], category: 'gymnastics' },

  // Dips (umbrella head)
  { id: 'dip', name: 'Dips', aliases: ['Dip'], category: 'gymnastics' },
  { id: 'ring-dip', name: 'Ring dips', aliases: ['Ring dip'], family: 'dip', equipment: ['Rings'], category: 'gymnastics' },
  { id: 'triceps-dip', name: 'Triceps dips', aliases: ['Tricep dips', 'Bench dips', 'Box dips'], family: 'dip', equipment: ['Bench'], category: 'strength' },

  // Rope climbs
  { id: 'rope-climb', name: 'Rope climbs', aliases: ['Rope climb'], equipment: ['Climbing rope'], category: 'gymnastics', notes: '15 ft / 4.5 m standard' },
  { id: 'legless-rope-climb', name: 'Legless rope climbs', family: 'rope-climb', equipment: ['Climbing rope'], category: 'gymnastics' },

  // L-sit
  { id: 'l-sit', name: 'L-sit', aliases: ['L-sit hold', 'L sit', 'L-sits'], equipment: ['Parallettes'], category: 'gymnastics' },

  // Sit-ups and core
  { id: 'sit-up', name: 'Sit-ups', aliases: ['Situps', 'Sit up'], category: 'conditioning' },
  { id: 'abmat-sit-up', name: 'AbMat sit-ups', spokenName: 'Ab mat sit-ups', aliases: ['Ab mat sit-ups', 'Abmat situps', 'AbMat situps'], family: 'sit-up', equipment: ['AbMat'], category: 'conditioning' },
  { id: 'ghd-sit-up', name: 'GHD sit-ups', spokenName: 'G H D sit-ups', aliases: ['GHD situps', 'GHDs'], family: 'sit-up', category: 'conditioning', notes: 'Needs a GHD machine' },
  { id: 'v-up', name: 'V-ups', spokenName: 'Vee ups', aliases: ['V ups', 'Vups'], family: 'sit-up', category: 'conditioning' },
  { id: 'hollow-rock', name: 'Hollow rocks', family: 'sit-up', category: 'gymnastics' },
  { id: 'hollow-hold', name: 'Hollow hold', aliases: ['Hollow body hold', 'Hollow holds', 'Core hold'], family: 'sit-up', category: 'gymnastics' },
  { id: 'russian-twist', name: 'Russian twists', family: 'sit-up', category: 'conditioning' },
  { id: 'bicycle-crunch', name: 'Bicycle crunches', aliases: ['Bicycles'], family: 'sit-up', category: 'conditioning' },
  { id: 'plank', name: 'Plank', aliases: ['Plank hold', 'Front plank', 'Planks'], category: 'conditioning' },
  { id: 'plank-shoulder-tap', name: 'Plank shoulder taps', aliases: ['Shoulder taps'], family: 'plank', category: 'conditioning' },
  { id: 'side-plank', name: 'Side plank', aliases: ['Side planks', 'Side plank hold'], family: 'plank', category: 'conditioning' },

  // Burpees
  { id: 'burpee', name: 'Burpees', aliases: ['Burpee'], category: 'conditioning' },
  { id: 'burpee-over-bar', name: 'Burpees over bar', aliases: ['Bar-facing burpees', 'Bar facing burpees', 'Burpees over the bar', 'Burpee over bar'], family: 'burpee', equipment: ['Barbell'], category: 'conditioning' },
  { id: 'lateral-burpee-over-bar', name: 'Lateral burpees over bar', shortName: 'Lateral bar burpees', aliases: ['Lateral burpees over the bar', 'Lateral bar-facing burpees', 'Lateral burpees'], family: 'burpee', equipment: ['Barbell'], category: 'conditioning' },
  { id: 'burpee-over-dumbbell', name: 'Burpees over dumbbells', shortName: 'Burpees over DBs', aliases: ['Burpees over dumbbell', 'Burpees over the dumbbell', 'Burpee over dumbbells', 'Dumbbell-facing burpees'], family: 'burpee', equipment: ['Dumbbells'], category: 'conditioning' },
  { id: 'burpee-over-rower', name: 'Burpees over rower', aliases: ['Burpees over the rower', 'Burpee over rower', 'Burpees over erg'], family: 'burpee', equipment: ['Rowing machine'], category: 'conditioning' },
  { id: 'burpee-box-jump-over', name: 'Burpee box jump overs', shortName: 'Burpee BJO', aliases: ['Burpee box jump-overs', 'BBJO', 'Burpee box jump over'], family: 'burpee', equipment: ['Plyo box'], category: 'conditioning' },
  { id: 'burpee-box-jump', name: 'Burpee box jumps', aliases: ['Burpee box jump'], family: 'burpee', equipment: ['Plyo box'], category: 'conditioning' },
  { id: 'burpee-broad-jump', name: 'Burpee broad jumps', aliases: ['Burpee broad jump'], family: 'burpee', category: 'conditioning' },
  { id: 'burpee-pull-up', name: 'Burpee pull-ups', aliases: ['Burpee pullups'], family: 'burpee', equipment: ['Pull-up bar'], category: 'conditioning' },
  { id: 'devil-press', name: 'Devil presses', aliases: ['Dumbbell devil presses', 'DB devil presses'], equipment: ['Dumbbells'], category: 'conditioning', notes: 'Burpee into a double dumbbell snatch' },
  { id: 'man-maker', name: 'Man makers', aliases: ['Manmakers', 'Dumbbell man makers'], equipment: ['Dumbbells'], category: 'conditioning', notes: 'Push-up, row each side, squat clean, thruster' },

  // Box jumps
  { id: 'box-jump', name: 'Box jumps', aliases: ['Box jump', 'BJ'], equipment: ['Plyo box'], category: 'conditioning', notes: '24 in men / 20 in women' },
  { id: 'box-jump-over', name: 'Box jump overs', aliases: ['Box jump-overs', 'BJO', 'Box jump over'], family: 'box-jump', equipment: ['Plyo box'], category: 'conditioning' },
  { id: 'box-step-up', name: 'Box step-ups', aliases: ['Step-ups', 'Box step ups', 'Step ups'], family: 'box-jump', equipment: ['Plyo box'], category: 'conditioning' },
  { id: 'box-step-over', name: 'Box step-overs', aliases: ['Step-overs', 'Box step overs'], family: 'box-jump', equipment: ['Plyo box'], category: 'conditioning' },
  { id: 'dumbbell-box-step-up', name: 'Dumbbell box step-ups', shortName: 'DB box step-ups', aliases: ['DB box step-ups', 'Weighted step-ups', 'Dumbbell step-ups'], family: 'box-jump', equipment: ['Plyo box', 'Dumbbells'], category: 'conditioning' },
  { id: 'broad-jump', name: 'Broad jumps', aliases: ['Standing broad jumps', 'Broad jump'], category: 'conditioning' },

  // Lunges
  { id: 'lunge', name: 'Lunges', aliases: ['Lunge', 'Forward lunges'], category: 'conditioning' },
  { id: 'alternating-lunge', name: 'Alternating lunges', aliases: ['Alternating leg lunges'], family: 'lunge', category: 'conditioning' },
  { id: 'walking-lunge', name: 'Walking lunges', family: 'lunge', category: 'conditioning' },
  { id: 'reverse-lunge', name: 'Reverse lunges', aliases: ['Backward lunges'], family: 'lunge', category: 'conditioning' },
  { id: 'jumping-lunge', name: 'Jumping lunges', aliases: ['Jump lunges', 'Lunge jumps'], family: 'lunge', category: 'conditioning' },
  { id: 'overhead-lunge', name: 'Overhead lunges', aliases: ['Barbell overhead lunges', 'Overhead walking lunges'], family: 'lunge', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'front-rack-lunge', name: 'Front rack lunges', aliases: ['Barbell front rack lunges', 'Front rack walking lunges'], family: 'lunge', equipment: ['Barbell'], category: 'weightlifting' },
  { id: 'dumbbell-overhead-lunge', name: 'Dumbbell overhead lunges', shortName: 'DB overhead lunges', aliases: ['DB overhead lunges', 'Overhead dumbbell lunges'], family: 'lunge', equipment: ['Dumbbells'], category: 'conditioning' },
  { id: 'dumbbell-overhead-walking-lunge', name: 'Dumbbell overhead walking lunges', shortName: 'DB OH walking lunges', aliases: ['DB overhead walking lunges', 'Overhead dumbbell walking lunges'], family: 'lunge', equipment: ['Dumbbells'], category: 'conditioning' },
  { id: 'dumbbell-front-rack-lunge', name: 'Dumbbell front rack lunges', shortName: 'DB front rack lunges', aliases: ['DB front rack lunges', 'Front rack dumbbell lunges'], family: 'lunge', equipment: ['Dumbbells'], category: 'conditioning' },
  { id: 'dumbbell-walking-lunge', name: 'Dumbbell walking lunges', shortName: 'DB walking lunges', aliases: ['DB walking lunges', 'Dumbbell lunges', 'DB lunges'], family: 'lunge', equipment: ['Dumbbells'], category: 'conditioning' },
  { id: 'sandbag-lunge', name: 'Sandbag lunges', aliases: ['Sandbag walking lunges'], family: 'lunge', equipment: ['Sandbag'], category: 'conditioning' },

  // Carries
  { id: 'farmers-carry', name: 'Farmers carry', aliases: ["Farmer's carry", 'Farmers walk', 'Farmer carry', 'Farmers carries'], equipment: ['Kettlebell'], category: 'strength', notes: 'Kettlebells unless the workout says dumbbells' },
  { id: 'dumbbell-farmers-carry', name: 'Dumbbell farmers carry', shortName: 'DB farmers carry', aliases: ['DB farmers carry', 'Dumbbell farmers walk'], family: 'farmers-carry', equipment: ['Dumbbells'], category: 'strength' },
  { id: 'kettlebell-farmers-carry', name: 'Kettlebell farmers carry', shortName: 'KB farmers carry', aliases: ['KB farmers carry', 'Kettlebell farmers walk'], family: 'farmers-carry', equipment: ['Kettlebell'], category: 'strength' },
  { id: 'farmers-carry-shuttle', name: 'Farmers carry shuttles', shortName: 'Carry shuttles', aliases: ['Farmers carry shuttle runs', 'Carry shuttles'], family: 'farmers-carry', equipment: ['Kettlebell'], category: 'strength' },
  { id: 'farmer-march', name: 'Farmer march', aliases: ['Farmers march', "Farmer's march", 'Farmers carry march'], family: 'farmers-carry', equipment: ['Kettlebell'], category: 'strength' },
  { id: 'kettlebell-suitcase-carry', name: 'Kettlebell suitcase carry', shortName: 'KB suitcase carry', aliases: ['Suitcase carry', 'KB suitcase carry', 'Single-arm farmers carry'], family: 'farmers-carry', equipment: ['Kettlebell'], category: 'strength' },
  { id: 'front-rack-carry', name: 'Front rack carry', aliases: ['Front rack kettlebell carry', 'Double kettlebell front rack carry'], family: 'farmers-carry', equipment: ['Kettlebell'], category: 'strength' },
  { id: 'overhead-carry', name: 'Overhead carry', aliases: ['Overhead dumbbell carry', 'Overhead kettlebell carry', 'Waiters walk'], family: 'farmers-carry', equipment: ['Dumbbells'], category: 'strength' },
  { id: 'sandbag-carry', name: 'Sandbag carry', aliases: ['Sandbag carries', 'Sandbag bear hug carry', 'Bear hug carry'], family: 'farmers-carry', equipment: ['Sandbag'], category: 'conditioning' },
  { id: 'sandbag-over-shoulder', name: 'Sandbag over shoulder', aliases: ['Sandbag to shoulder', 'Sandbag over the shoulder'], equipment: ['Sandbag'], category: 'conditioning' },
  { id: 'plate-pinch-hold', name: 'Plate pinch hold', aliases: ['Plate pinch', 'Plate pinch holds'], equipment: ['Weight plate'], category: 'strength' },

  // Sled
  { id: 'sled-push', name: 'Sled push', aliases: ['Sled pushes', 'Prowler push'], equipment: ['Sled'], category: 'strength' },
  { id: 'sled-pull', name: 'Sled pull', aliases: ['Sled pulls', 'Rope sled pull'], equipment: ['Sled'], category: 'strength' },
  { id: 'sled-drag', name: 'Sled drag', aliases: ['Sled drags', 'Backwards sled drag'], equipment: ['Sled'], category: 'strength' },

  // Monostructural
  { id: 'row', name: 'Row', aliases: ['Rowing', 'Rower', 'Row (cal)', 'Row (m)', 'Row for calories', 'Erg row'], equipment: ['Rowing machine'], category: 'monostructural' },
  { id: 'run', name: 'Run', aliases: ['Running', 'Run (m)', 'Run (km)', 'Jog'], category: 'monostructural' },
  { id: 'run-together', name: 'Run together', aliases: ['Partner run', 'Team run'], family: 'run', category: 'monostructural' },
  { id: 'shuttle-run', name: 'Shuttle runs', aliases: ['Shuttle sprints', 'Shuttles', 'Shuttle run'], family: 'run', category: 'monostructural' },
  { id: 'sprint', name: 'Sprints', aliases: ['Sprint', 'Run sprints'], family: 'run', category: 'monostructural' },
  { id: 'ski', name: 'SkiErg', spokenName: 'Ski erg', aliases: ['Ski', 'Ski erg', 'Ski (cal)', 'Skiing', 'SkiErg (cal)'], equipment: ['SkiErg'], category: 'monostructural' },
  { id: 'bike', name: 'Bike', aliases: ['Bike (cal)', 'Cycling', 'Bike erg', 'BikeErg', 'Biking'], equipment: ['Bike'], category: 'monostructural' },
  { id: 'assault-bike', name: 'Assault bike', aliases: ['Air bike', 'Assault bike (cal)', 'Fan bike'], family: 'bike', equipment: ['Bike'], category: 'monostructural' },
  { id: 'echo-bike', name: 'Echo bike', aliases: ['Echo bike (cal)'], family: 'bike', equipment: ['Bike'], category: 'monostructural' },
  { id: 'double-under', name: 'Double-unders', aliases: ['DU', 'DUs', 'Double unders', 'Dubs'], equipment: ['Jump rope'], category: 'monostructural' },
  { id: 'single-under', name: 'Single-unders', aliases: ['SU', 'Single unders', 'Singles', 'Jump rope', 'Skipping'], family: 'double-under', equipment: ['Jump rope'], category: 'monostructural' },
  { id: 'crossover', name: 'Crossovers', aliases: ['Crossover double-unders', 'Cross-overs'], family: 'double-under', equipment: ['Jump rope'], category: 'monostructural' },

  // Bodyweight conditioning
  { id: 'jumping-jack', name: 'Jumping jacks', aliases: ['Star jumps'], category: 'conditioning' },
  { id: 'high-knee', name: 'High knees', aliases: ['High knee runs'], category: 'conditioning' },
  { id: 'mountain-climber', name: 'Mountain climbers', category: 'conditioning' },
  { id: 'skater-jump', name: 'Skater jumps', aliases: ['Skaters', 'Lateral skater jumps'], category: 'conditioning' },

  // Accessory strength
  { id: 'bent-over-row', name: 'Bent-over rows', aliases: ['Barbell rows', 'Bent over rows', 'Barbell bent-over rows'], equipment: ['Barbell'], category: 'strength' },
  { id: 'dumbbell-row', name: 'Dumbbell rows', aliases: ['DB rows', 'Single-arm dumbbell rows', 'Bent-over dumbbell rows'], family: 'bent-over-row', equipment: ['Dumbbells'], category: 'strength' },
  { id: 'renegade-row', name: 'Renegade rows', aliases: ['Plank rows'], family: 'bent-over-row', equipment: ['Dumbbells'], category: 'strength' },
  { id: 'biceps-curl', name: 'Biceps curls', aliases: ['Bicep curls', 'Dumbbell curls', 'DB curls'], equipment: ['Dumbbells'], category: 'strength' },
  { id: 'overhead-triceps-extension', name: 'Overhead triceps extensions', shortName: 'Triceps extensions', aliases: ['Triceps extensions', 'Tricep extensions', 'Skull crushers'], equipment: ['Dumbbells'], category: 'strength' },
  { id: 'dumbbell-woodchopper', name: 'Dumbbell woodchoppers', shortName: 'DB woodchoppers', aliases: ['Woodchoppers', 'DB woodchoppers', 'Wood chops'], equipment: ['Dumbbells'], category: 'conditioning' },
  { id: 'good-morning', name: 'Good mornings', aliases: ['Barbell good mornings'], equipment: ['Barbell'], category: 'strength' },
  { id: 'turkish-get-up', name: 'Turkish get-ups', aliases: ['TGU', 'Get-ups', 'Kettlebell Turkish get-ups'], equipment: ['Kettlebell'], category: 'strength' },
  { id: 'ground-to-overhead', name: 'Ground-to-overhead', aliases: ['G2OH', 'Ground to overhead', 'Barbell ground-to-overhead'], equipment: ['Barbell'], category: 'weightlifting', notes: 'Any style from the floor to lockout' },

  // Mobility and recovery
  { id: 'inchworm', name: 'Inchworms', aliases: ['Inchworm walkouts', 'Inchworm'], category: 'mobility' },
  { id: 'arm-circle', name: 'Arm circles', aliases: ['Arm circles & shoulder mobility', 'Arm circles and shoulder mobility', 'Shoulder circles'], category: 'mobility' },
  { id: 'hip-hinge', name: 'Hip hinges', aliases: ['Hip hinge drill', 'Hip hinge'], category: 'mobility' },
  { id: 'chest-and-shoulder-stretch', name: 'Chest & shoulder stretch', shortName: 'Chest stretch', aliases: ['Chest and shoulder stretch', 'Chest stretch', 'Shoulder stretch', 'Pec stretch'], category: 'mobility' },
  { id: 'hamstring-stretch', name: 'Hamstring stretch', aliases: ['Hamstring stretches'], category: 'mobility' },
  { id: 'hip-flexor-stretch', name: 'Hip flexor stretch', aliases: ['Couch stretch', 'Hip flexor stretches'], category: 'mobility' },
  { id: 'quad-stretch', name: 'Quad stretch', aliases: ['Quadriceps stretch', 'Quad stretches'], category: 'mobility' },
  { id: 'calf-stretch', name: 'Calf stretch', aliases: ['Calf stretches'], category: 'mobility' },
  { id: 'pigeon-stretch', name: 'Pigeon stretch', aliases: ['Pigeon pose'], category: 'mobility' },
  { id: 'active-recovery', name: 'Active recovery', aliases: ['Recovery', 'Easy movement', 'Shake out'], category: 'mobility' },
  { id: 'deep-breathing', name: 'Deep breathing', aliases: ['Breathing', 'Box breathing', 'Breathe'], category: 'mobility' },
  { id: 'rest', name: 'Rest', aliases: ['Break', 'Recover'], category: 'mobility' },
];
