export interface ModeInfo {
  path: string;
  title: string;
  blurb: string;
  icon: string;
  status: 'ready' | 'soon';
}

export const modes: ModeInfo[] = [
  {
    path: '/sensor-check',
    title: 'Sensor check',
    blurb: 'See what your phone’s speaker, mic and sensors can do. Run this first.',
    icon: '🎚️',
    status: 'ready',
  },
  {
    path: '/level',
    title: 'Liquid level',
    blurb: 'How many litres are in that bucket? Tap it, ping it, or photograph it.',
    icon: '🪣',
    status: 'ready',
  },
  {
    path: '/knock',
    title: 'Knock ID',
    blurb:
      'Teach it what things sound like when knocked, then tell them apart. Fruit firmness too.',
    icon: '✊',
    status: 'ready',
  },
  {
    path: '/room',
    title: 'Room acoustics',
    blurb: 'Reverb time (RT60) from a clap.',
    icon: '🏛️',
    status: 'ready',
  },
  {
    path: '/ruler',
    title: 'Sonar ruler',
    blurb: 'Distance to a wall using sound.',
    icon: '📏',
    status: 'ready',
  },
  {
    path: '/metal',
    title: 'Metal finder',
    blurb: 'Iron and steel by how they bend the magnetic field. Works on iPhone too.',
    icon: '🧲',
    status: 'ready',
  },
  {
    path: '/alerts',
    title: 'Sound alerts',
    blurb: 'Smoke and CO alarms out of the box; teach it the doorbell or washer chime.',
    icon: '🔔',
    status: 'ready',
  },
  {
    path: '/presence',
    title: 'Presence',
    blurb: 'Near-ultrasonic sonar: movement nearby, and breathing rate when still.',
    icon: '🫁',
    status: 'ready',
  },
];
