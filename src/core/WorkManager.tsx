const DEFAULT_WORK_PER_FRAME = 2;

export type WorkRequester = () => Promise<THREE.WebGLRenderer>;

interface WorkTask {
  resolve: (gl: THREE.WebGLRenderer) => void;
  reject: (error: unknown) => void;
  promise: Promise<unknown> | null;
}

const DUMMY_RESOLVER = (_gl: THREE.WebGLRenderer) => {};
const DUMMY_REJECTOR = (_error: unknown) => {};

// simple job queue to schedule per-frame work
// (with some tricks like randomizing the task pop, etc)
export function createWorkManager(
  gl: THREE.WebGLRenderer,
  abortPromise: Promise<void>,
  workPerFrame?: number
): WorkRequester {
  const workPerFrameReal = Math.max(1, workPerFrame || DEFAULT_WORK_PER_FRAME);

  let rafActive = false;
  const pendingTasks: WorkTask[] = [];

  // wait for early stop
  let isStopped = false;
  abortPromise.then(() => {
    // prevent further scheduling
    isStopped = true;

    // clear out all the pending tasks
    const cleanupList = [...pendingTasks];
    pendingTasks.length = 0;

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
  });

  // awaitable request for next microtask inside RAF
  const requestWork = () => {
    // this helps break out of long-running async jobs
    if (isStopped) {
      throw new Error('work manager is no longer available');
    }

    // schedule next RAF if needed
    if (!rafActive) {
      rafActive = true;

      async function rafRun() {
        for (let i = 0; i < workPerFrameReal; i += 1) {
          if (pendingTasks.length === 0) {
            // break out and stop the RAF loop for now
            rafActive = false;
            return;
          }

          // pick random microtask to run
          const taskIndex = Math.floor(Math.random() * pendingTasks.length);
          const task = pendingTasks[taskIndex];
          pendingTasks.splice(taskIndex, 1);

          // notify pending worker
          task.resolve(gl);

          // give worker enough time to finish and possibly queue more work
          // to be run as part of this macrotask's frame
          await task.promise;
          await task.promise; // @todo this second await seems to make a difference to let worker finish on time!
        }

        // schedule more work right away in case more tasks are around
        requestAnimationFrame(rafRun);
      }

      requestAnimationFrame(rafRun);
    }

    // schedule the microtask
    let taskResolve = DUMMY_RESOLVER;
    let taskReject = DUMMY_REJECTOR;

    const promise = new Promise<THREE.WebGLRenderer>((resolve, reject) => {
      taskResolve = resolve;
      taskReject = reject;
    });

    pendingTasks.push({
      resolve: taskResolve,
      reject: taskReject,
      promise: promise
    });

    return promise;
  };

  return requestWork;
}
