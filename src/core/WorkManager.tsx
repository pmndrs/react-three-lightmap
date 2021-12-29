import React, {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useContext
} from 'react';
import { useThree } from '@react-three/fiber';

const WORK_PER_FRAME = 2;

export type WorkRequester = () => Promise<THREE.WebGLRenderer>;
export const WorkManagerContext = React.createContext<WorkRequester | null>(
  null
);

interface WorkTask {
  resolve: (gl: THREE.WebGLRenderer) => void;
  reject: (error: unknown) => void;
}

export function useWorkRequest() {
  const requester = useContext(WorkManagerContext);
  if (!requester) {
    throw new Error('must be inside work manager');
  }

  // track on-unmount callback
  const unmountedCbRef = useRef(() => {});
  useEffect(() => {
    return () => {
      unmountedCbRef.current();
    };
  }, []);

  // wrap requester with local unmount check as well
  const wrappedRequester = useMemo(() => {
    // reject when this is unmounted
    const whenUnmounted = new Promise<void>((resolve) => {
      unmountedCbRef.current = resolve;
    }).then(() => {
      throw new Error('work requester was unmounted');
    });

    // silence the rejection in case this is never listened to
    whenUnmounted.catch(() => {
      // no-op
    });

    // combine the normal RAF promise with the unmount rejection
    return () =>
      Promise.race<THREE.WebGLRenderer>([whenUnmounted, requester()]);
  }, [requester]);

  return wrappedRequester;
}

// this simply acts as a central spot to schedule per-frame work
// (allowing eventual possibility of e.g. multiple unrelated bakers co-existing within a single central work manager)
// @todo use parent context if available
const WorkManager: React.FC = ({ children }) => {
  const { gl } = useThree(); // @todo use state selector

  const rafActiveRef = useRef(false);
  const pendingTasksRef = useRef<WorkTask[]>([]);

  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => {
      // prevent further scheduling
      unmountedRef.current = true;

      // clear out all the pending tasks
      const cleanupList = [...pendingTasksRef.current];
      pendingTasksRef.current.length = 0;

      // safely notify existing awaiters that no more work can be done at all
      // (this helps clean up async jobs that were already scheduled)
      for (const task of cleanupList) {
        try {
          task.reject(
            new Error('work manager was unmounted while waiting for RAF')
          );
        } catch (_error) {
          // no-op
        }
      }
    };
  }, []);

  // awaitable request for next microtask inside RAF
  const requestWork = useCallback(() => {
    // this helps break out of long-running async jobs
    if (unmountedRef.current) {
      throw new Error('work manager is no longer available');
    }

    // schedule next RAF if needed
    if (!rafActiveRef.current) {
      rafActiveRef.current = true;

      function rafRun() {
        for (let i = 0; i < WORK_PER_FRAME; i += 1) {
          if (pendingTasksRef.current.length === 0) {
            // break out and stop the RAF loop for now
            rafActiveRef.current = false;
            return;
          }

          // pick random microtask to run
          const taskIndex = Math.floor(
            Math.random() * pendingTasksRef.current.length
          );
          const task = pendingTasksRef.current[taskIndex];
          pendingTasksRef.current.splice(taskIndex, 1);

          // @todo await this before finishing RAF macro task
          task.resolve(gl);
        }

        // schedule more work right away in case more tasks are around
        requestAnimationFrame(rafRun);
      }

      requestAnimationFrame(rafRun);
    }

    // schedule the microtask
    return new Promise<THREE.WebGLRenderer>((resolve, reject) => {
      pendingTasksRef.current.push({
        resolve,
        reject
      });
    });
  }, [gl]);

  return (
    <>
      <WorkManagerContext.Provider value={requestWork}>
        {children}
      </WorkManagerContext.Provider>
    </>
  );
};

export default WorkManager;
