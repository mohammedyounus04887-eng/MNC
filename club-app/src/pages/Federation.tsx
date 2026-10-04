import FederationPanel from "@/components/FederationPanel";
import { auth } from "@/lib/firebase";
import { clubFederationEndpoint } from "@/lib/federationClient";
import { useClubContext } from "@/lib/clubDetection";
const ownAuth = () => auth;
export default function Federation() {
  const { club } = useClubContext();
  return <FederationPanel destinationClubId={club?.id} app="club" getAuth={ownAuth} endpoint={clubFederationEndpoint()} onSignedIn={async () => { window.location.assign("/member/dashboard"); }} />;
}
