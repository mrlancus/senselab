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
    blurb: 'How many litres are in that bucket? Tap it or ping it (camera coming).',
    icon: '🪣',
    status: 'ready',
  },
  {
    path: '/knock',
    title: 'Knock ID',
    blurb: 'Identify objects by the sound of a knock.',
    icon: '✊',
    status: 'soon',
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
    blurb: 'Magnetometer-based (Android Chrome).',
    icon: '🧲',
    status: 'soon',
  },
  {
    path: '/alerts',
    title: 'Sound alerts',
    blurb: 'Washer done, smoke alarm, doorbell.',
    icon: '🔔',
    status: 'soon',
  },
  {
    path: '/presence',
    title: 'Presence',
    blurb: 'Sonar breathing / motion detection.',
    icon: '🫁',
    status: 'soon',
  },
];
