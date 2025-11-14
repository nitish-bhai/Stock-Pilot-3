
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDWBos5f3koVvfnJ5otTvHVIzD4QDGNvjU",
  authDomain: "studio-8371121982-c36f9.firebaseapp.com",
  projectId: "studio-8371121982-c36f9",
  storageBucket: "studio-8371121982-c36f9.firebasestorage.app",
  messagingSenderId: "939482534019",
  appId: "1:939482534019:web:0ef3816f1c10398559cbb6"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
