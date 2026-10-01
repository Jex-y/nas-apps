import { createContext, useContext } from "react";
import type { Store } from "../lib/store";

export const StoreContext = createContext<Store | null>(null);

export const useStore = (): Store => {
  const store = useContext(StoreContext);
  if (store === null) {
    throw new Error("useStore needs a StoreContext provider above it");
  }
  return store;
};
