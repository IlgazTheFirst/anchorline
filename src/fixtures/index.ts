import demo from './synthetic-demo-trip.json';
import { tripDocument, type TripDocument } from '../domain/schema';

/** The fictional demo trip. Every place, event, time and price in it is invented. */
export function demoTrip(): TripDocument {
  return tripDocument.parse(structuredClone(demo));
}
