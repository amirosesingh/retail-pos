import { hostedFunction } from "./hosted-function-client";
import { signInWithPasswordUsername as direct } from "./password-username.functions";

export const signInWithPasswordUsername = hostedFunction("password-username.signInWithPasswordUsername", direct);
