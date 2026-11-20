import { Redirect } from 'expo-router';

// A link into the app (armus://..., a notification) to a screen that
// doesn't exist showed Expo Router's own black "Unmatched Route" page, in
// English, with a sitemap of every screen. It goes to the start instead,
// which sends the person to their own home tab or to sign-in.
export default function NotFound() {
  return <Redirect href="/" />;
}
