export type Region = 'eu' | 'na' | 'sa' | 'as' | 'af' | 'me' | 'oc';

export interface Collector {
  city: string;
  lat: number;
  lon: number;
  multihop: boolean;
  region: Region;
}

const at = (city: string, lat: number, lon: number, region: Region, multihop = false) => ({
  city,
  lat,
  lon,
  multihop,
  region
});

/** RIPE's active route collectors, where every update we hear about was recorded */
export const collectors: Record<string, Collector> = {
  rrc00: at('Amsterdam', 52.37, 4.89, 'eu', true),
  rrc01: at('London', 51.51, -0.13, 'eu'),
  rrc03: at('Amsterdam', 52.36, 4.95, 'eu'),
  rrc04: at('Geneva', 46.2, 6.14, 'eu'),
  rrc05: at('Vienna', 48.21, 16.37, 'eu'),
  rrc06: at('Tokyo', 35.69, 139.77, 'as'),
  rrc07: at('Stockholm', 59.33, 18.07, 'eu'),
  rrc10: at('Milan', 45.46, 9.19, 'eu'),
  rrc11: at('New York', 40.71, -74.01, 'na'),
  rrc12: at('Frankfurt', 50.11, 8.68, 'eu'),
  rrc13: at('Moscow', 55.76, 37.62, 'eu'),
  rrc14: at('Palo Alto', 37.44, -122.14, 'na'),
  rrc15: at('São Paulo', -23.55, -46.63, 'sa'),
  rrc16: at('Miami', 25.76, -80.19, 'na'),
  rrc18: at('Barcelona', 41.39, 2.17, 'eu'),
  rrc19: at('Johannesburg', -26.2, 28.05, 'af'),
  rrc20: at('Zurich', 47.37, 8.54, 'eu'),
  rrc21: at('Paris', 48.86, 2.35, 'eu'),
  rrc22: at('Bucharest', 44.43, 26.1, 'eu'),
  rrc23: at('Singapore', 1.29, 103.85, 'as'),
  rrc24: at('Montevideo', -34.9, -56.16, 'sa', true),
  rrc25: at('Amsterdam', 52.38, 4.9, 'eu', true),
  rrc26: at('Dubai', 25.2, 55.27, 'me')
};
