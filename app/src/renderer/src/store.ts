import { create } from 'zustand'

export interface Selection {
  x: number
  y: number
  width: number
  height: number
}

interface StoreState {
  selection: Selection | null
  setSelection: (rect: Selection | null) => void
}

export const useStore = create<StoreState>((set) => ({
  selection: null,
  setSelection: (rect) => set({ selection: rect })
}))
