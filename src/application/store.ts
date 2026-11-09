export type Listener<S> = (state: S, prev: S) => void;

export interface Store<S, A> {
    getState(): S;
    dispatch(action: A): void;
    subscribe(listener: Listener<S>): () => void;
}

export function createStore<S, A>(reducer: (s: S, a: A) => S, initial: S): Store<S, A> {
    let state = initial;
    const listeners = new Set<Listener<S>>();

    return {
        getState: () => state,
        dispatch(action) {
            const prev = state;
            state = reducer(state, action);

            if (state !== prev) listeners.forEach((l) => l(state, prev));
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}