# Club emulator security gate

Run `npm run test:security` from the Club repository. This uses the project-local Firebase CLI, Java, and `@firebase/rules-unit-testing`. `firebase.security.json` starts only Firestore and Storage on loopback using the non-production `demo-club-security` project. The runner refuses endpoints outside loopback. Never substitute a production project ID.

`rules.test.mjs` executes the manifest plus additional anonymous-Auth, protected-PIN, nested-wallet, and payment denial cases. The manifest's null actor means signed out; the runner separately tests anonymous Firebase Auth. Syntax validation alone is not a rules test result. The full gate also requires enrollment and actual reception/kitchen/TV workflow coverage; this initial regression runner does not claim that coverage.

`club-rules-cases.json` is the required ALLOW/DENY matrix for the Firestore and Storage rules. Run it with the Firebase Rules emulator before promoting rules. The fixture deliberately covers station roles, wrong-club access, anonymous access, PIN secrecy, wallet-style privileged writes, Storage isolation, and platform-admin separation.

The station enrollment callable creates the Firebase Auth principal and the corresponding `clubs/{clubId}/authorizations/{uid}` record. Emulator tests must seed that record for each station claim and must assert both the callable authorization path and direct rules access.
