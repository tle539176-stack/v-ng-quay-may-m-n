(function (global) {
  'use strict';

  var UINT32_RANGE = 0x100000000;
  var ENGINE_VERSION = 2;
  var DRAMA_MODES = ['comeback', 'neck-and-neck', 'early-lead'];
  var CHECKPOINT_TIMES = [0, 0.1, 0.22, 0.36, 0.5, 0.64, 0.76, 0.86, 0.94, 1];

  function assert(condition, message) {
    if (!condition) throw new TypeError(message);
  }

  function cryptoSource() {
    var source = global.crypto;
    if (!source || typeof source.getRandomValues !== 'function') {
      throw new Error('Web Crypto is required for secure race selection.');
    }
    return source;
  }

  /** Return an unbiased integer in [0, length) using rejection sampling. */
  function secureRandomIndex(length) {
    assert(Number.isSafeInteger(length), 'length must be a safe integer.');
    assert(length > 0 && length <= UINT32_RANGE, 'length must be between 1 and 2^32.');

    var sample = new Uint32Array(1);
    var limit = Math.floor(UINT32_RANGE / length) * length;
    do {
      cryptoSource().getRandomValues(sample);
    } while (sample[0] >= limit);
    return sample[0] % length;
  }

  function freshSeed() {
    var sample = new Uint32Array(1);
    cryptoSource().getRandomValues(sample);
    return sample[0] >>> 0;
  }

  function hashSeed(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
    var text = String(value);
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createPrng(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var result = state;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / UINT32_RANGE;
    };
  }

  function randomBetween(prng, minimum, maximum) {
    return minimum + (maximum - minimum) * prng();
  }

  function shuffle(values, prng) {
    var result = values.slice();
    for (var index = result.length - 1; index > 0; index -= 1) {
      var swapIndex = Math.floor(prng() * (index + 1));
      var temporary = result[index];
      result[index] = result[swapIndex];
      result[swapIndex] = temporary;
    }
    return result;
  }

  function chooseDramaMode(prng) {
    var roll = prng();
    if (roll < 0.4) return 'comeback';
    if (roll < 0.75) return 'neck-and-neck';
    return 'early-lead';
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function winnerCurve(mode) {
    if (mode === 'comeback') {
      return [0, 0.055, 0.13, 0.235, 0.39, 0.565, 0.72, 0.84, 0.93, 1];
    }
    if (mode === 'early-lead') {
      return [0, 0.14, 0.29, 0.45, 0.61, 0.74, 0.84, 0.91, 0.96, 1];
    }
    return [0, 0.09, 0.21, 0.35, 0.51, 0.66, 0.78, 0.87, 0.94, 1];
  }

  function primaryRivalCurve(mode) {
    if (mode === 'comeback') {
      return [0, 0.11, 0.25, 0.41, 0.57, 0.7, 0.8, 0.87, 0.94, 1];
    }
    if (mode === 'early-lead') {
      return [0, 0.095, 0.22, 0.36, 0.51, 0.65, 0.76, 0.84, 0.92, 1];
    }
    return [0, 0.1, 0.225, 0.36, 0.525, 0.675, 0.8, 0.89, 0.958, 1];
  }

  function ordinaryCurve(prng) {
    var base = [0, 0.09, 0.21, 0.35, 0.5, 0.64, 0.75, 0.84, 0.92, 1];
    var result = base.slice();
    for (var index = 1; index < result.length - 1; index += 1) {
      var wave = Math.sin(index * randomBetween(prng, 1.3, 2.7)) * 0.012;
      result[index] += wave + randomBetween(prng, -0.012, 0.012);
    }
    return result;
  }

  function buildTrajectory(curve, finalProgress, prng, addJitter) {
    var points = [];
    var previous = 0;
    for (var index = 0; index < CHECKPOINT_TIMES.length; index += 1) {
      var isEndpoint = index === 0 || index === CHECKPOINT_TIMES.length - 1;
      var jitter = addJitter && !isEndpoint ? randomBetween(prng, -0.008, 0.008) : 0;
      var progress = clamp((curve[index] + jitter) * finalProgress, 0, finalProgress);
      if (index > 0) progress = Math.max(progress, previous + 0.001);
      if (index === CHECKPOINT_TIMES.length - 1) progress = finalProgress;
      progress = Math.min(progress, finalProgress);
      previous = progress;
      points.push({
        time: CHECKPOINT_TIMES[index],
        progress: Number(progress.toFixed(6))
      });
    }
    return points;
  }

  function getItemKey(item, itemIndex) {
    if (item && typeof item === 'object') {
      if (item.id !== undefined && item.id !== null) return String(item.id);
      if (item.key !== undefined && item.key !== null) return String(item.key);
      if (item.name !== undefined && item.name !== null) return String(item.name);
    }
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return String(itemIndex);
  }

  /**
   * Build a serializable, FPS-independent race plan for an already selected winner.
   * Pass options.seed to reproduce the exact same lanes and trajectories.
   */
  function createRacePlan(items, winnerIndex, options) {
    assert(Array.isArray(items), 'items must be an array.');
    assert(items.length > 0, 'items must contain at least one racer.');
    assert(Number.isInteger(winnerIndex), 'winnerIndex must be an integer.');
    assert(winnerIndex >= 0 && winnerIndex < items.length, 'winnerIndex is out of range.');

    var config = options || {};
    var durationMs = config.durationMs === undefined ? 9000 : Number(config.durationMs);
    assert(Number.isFinite(durationMs) && durationMs >= 1000, 'durationMs must be at least 1000.');

    var seed = config.seed === undefined ? freshSeed() : hashSeed(config.seed);
    var prng = createPrng(seed);
    var mode = config.dramaMode || chooseDramaMode(prng);
    assert(DRAMA_MODES.indexOf(mode) !== -1, 'Unknown dramaMode: ' + mode);

    var itemIndexes = items.map(function (_, index) { return index; });
    var laneOrder = config.shuffleLanes === false ? itemIndexes : shuffle(itemIndexes, prng);
    var loserIndexes = itemIndexes.filter(function (index) { return index !== winnerIndex; });
    var tentativeLoserOrder = shuffle(loserIndexes, prng);
    var loserFinals = {};

    tentativeLoserOrder.forEach(function (itemIndex, rankIndex) {
      var rankRatio = loserIndexes.length <= 1 ? 0 : rankIndex / (loserIndexes.length - 1);
      var maximum = rankIndex === 0 ? 0.985 : 0.965;
      var minimum = 0.875;
      var rankedTarget = maximum - rankRatio * (maximum - minimum);
      loserFinals[itemIndex] = clamp(rankedTarget + randomBetween(prng, -0.004, 0.004), minimum, 0.985);
    });

    // The small finish jitter can swap nearby racers in large fields, so publish the
    // order derived from their actual final positions instead of the tentative ranks.
    var finishOrder = [winnerIndex].concat(loserIndexes.slice().sort(function (first, second) {
      return loserFinals[second] - loserFinals[first] || first - second;
    }));
    var primaryRivalIndex = finishOrder.length > 1 ? finishOrder[1] : -1;
    var lanes = laneOrder.map(function (itemIndex, laneIndex) {
      var isWinner = itemIndex === winnerIndex;
      var isPrimaryRival = itemIndex === primaryRivalIndex;
      var finalProgress = isWinner ? 1 : loserFinals[itemIndex];
      var curve = isWinner
        ? winnerCurve(mode)
        : (isPrimaryRival ? primaryRivalCurve(mode) : ordinaryCurve(prng));
      return {
        laneIndex: laneIndex,
        itemIndex: itemIndex,
        itemKey: getItemKey(items[itemIndex], itemIndex),
        isWinner: isWinner,
        finalProgress: Number(finalProgress.toFixed(6)),
        trajectory: buildTrajectory(curve, finalProgress, prng, !isWinner && !isPrimaryRival)
      };
    });

    var plan = {
      version: ENGINE_VERSION,
      seed: seed,
      durationMs: Math.round(durationMs),
      dramaMode: mode,
      winnerIndex: winnerIndex,
      winnerLaneIndex: laneOrder.indexOf(winnerIndex),
      laneOrder: laneOrder,
      finishOrder: finishOrder,
      lanes: lanes
    };

    var validation = validateRacePlan(plan);
    if (!validation.valid) throw new Error('Invalid race plan: ' + validation.errors.join('; '));
    return plan;
  }

  /**
   * Precompute a monotone cubic Hermite curve. Unlike easing each segment in and
   * out, this keeps velocity continuous through checkpoints and avoids micro-stops.
   */
  function compileTrajectory(trajectory) {
    var widths = [];
    var slopes = [];
    var tangents = new Array(trajectory.length);
    for (var index = 0; index < trajectory.length - 1; index += 1) {
      var width = trajectory[index + 1].time - trajectory[index].time;
      widths.push(width);
      slopes.push((trajectory[index + 1].progress - trajectory[index].progress) / width);
    }

    // Every boat launches from rest; later tangents remain continuous and monotone.
    tangents[0] = 0;
    if (trajectory.length === 2) {
      tangents[1] = 0;
      return { points: trajectory, tangents: tangents };
    }
    for (var pointIndex = 1; pointIndex < trajectory.length - 1; pointIndex += 1) {
      var previousSlope = slopes[pointIndex - 1];
      var nextSlope = slopes[pointIndex];
      if (previousSlope <= 0 || nextSlope <= 0) {
        tangents[pointIndex] = 0;
      } else {
        var previousWeight = 2 * widths[pointIndex] + widths[pointIndex - 1];
        var nextWeight = widths[pointIndex] + 2 * widths[pointIndex - 1];
        tangents[pointIndex] = (previousWeight + nextWeight) /
          (previousWeight / previousSlope + nextWeight / nextSlope);
      }
    }
    var finalIndex = trajectory.length - 1;
    // Arrive with zero velocity so the visual does not snap from full speed to rest.
    tangents[finalIndex] = 0;
    return { points: trajectory, tangents: tangents };
  }

  function evaluateCompiledTrajectory(compiled, normalizedTime) {
    var points = compiled.points;
    if (normalizedTime <= 0) return { progress: points[0].progress, speed: 0, acceleration: 0 };
    var finalPoint = points[points.length - 1];
    if (normalizedTime >= 1) {
      return { progress: finalPoint.progress, speed: Math.max(0, compiled.tangents[compiled.tangents.length - 1]), acceleration: 0 };
    }

    for (var index = 1; index < points.length; index += 1) {
      var current = points[index];
      if (normalizedTime <= current.time) {
        var previous = points[index - 1];
        var width = current.time - previous.time;
        var localTime = (normalizedTime - previous.time) / width;
        var localSquared = localTime * localTime;
        var localCubed = localSquared * localTime;
        var previousTangent = compiled.tangents[index - 1];
        var currentTangent = compiled.tangents[index];
        var progress =
          (2 * localCubed - 3 * localSquared + 1) * previous.progress +
          (localCubed - 2 * localSquared + localTime) * width * previousTangent +
          (-2 * localCubed + 3 * localSquared) * current.progress +
          (localCubed - localSquared) * width * currentTangent;
        var speed = (
          (6 * localSquared - 6 * localTime) * previous.progress +
          (3 * localSquared - 4 * localTime + 1) * width * previousTangent +
          (-6 * localSquared + 6 * localTime) * current.progress +
          (3 * localSquared - 2 * localTime) * width * currentTangent
        ) / width;
        var acceleration = (
          (12 * localTime - 6) * previous.progress +
          (6 * localTime - 4) * width * previousTangent +
          (-12 * localTime + 6) * current.progress +
          (6 * localTime - 2) * width * currentTangent
        ) / (width * width);
        return {
          progress: clamp(progress, previous.progress, current.progress),
          speed: Math.max(0, speed),
          acceleration: acceleration
        };
      }
    }
    return { progress: finalPoint.progress, speed: 0, acceleration: 0 };
  }

  function enrichMotion(motion) {
    var speedIntensity = clamp((motion.speed - 0.42) / 1.18, 0, 1);
    var accelerationIntensity = clamp((motion.acceleration - 0.3) / 8.5, 0, 1);
    var boost = clamp(speedIntensity * 0.52 + accelerationIntensity * 0.72, 0, 1);
    return {
      progress: motion.progress,
      speed: Number(motion.speed.toFixed(6)),
      acceleration: Number(motion.acceleration.toFixed(6)),
      speedIntensity: Number(speedIntensity.toFixed(6)),
      boost: Number(boost.toFixed(6))
    };
  }

  function buildSnapshot(plan, normalizedTime, compiledLanes) {
    var lanes = plan.lanes.map(function (lane, laneIndex) {
      var motion = enrichMotion(evaluateCompiledTrajectory(compiledLanes[laneIndex], normalizedTime));
      return {
        laneIndex: lane.laneIndex,
        itemIndex: lane.itemIndex,
        itemKey: lane.itemKey,
        isWinner: lane.isWinner,
        progress: motion.progress,
        speed: motion.speed,
        acceleration: motion.acceleration,
        speedIntensity: motion.speedIntensity,
        boost: motion.boost
      };
    });
    var standings = lanes.slice().sort(function (first, second) {
      return second.progress - first.progress || first.laneIndex - second.laneIndex;
    });
    standings.forEach(function (lane, index) { lane.rank = index + 1; });
    var rankByLane = {};
    standings.forEach(function (lane) { rankByLane[lane.laneIndex] = lane.rank; });
    lanes.forEach(function (lane) { lane.rank = rankByLane[lane.laneIndex]; });

    return {
      progress: normalizedTime,
      elapsedMs: Math.round(normalizedTime * plan.durationMs),
      finished: normalizedTime >= 1,
      leaderIndex: standings[0].itemIndex,
      lanes: lanes,
      standings: standings
    };
  }

  /** Validate and compile once for animation loops that evaluate the same plan per frame. */
  function createRaceEvaluator(plan) {
    var validation = validateRacePlan(plan);
    if (!validation.valid) throw new TypeError('Invalid race plan: ' + validation.errors.join('; '));
    var compiledLanes = plan.lanes.map(function (lane) { return compileTrajectory(lane.trajectory); });
    return function (progress) {
      return buildSnapshot(plan, clamp(Number(progress) || 0, 0, 1), compiledLanes);
    };
  }

  /** Evaluate positions from normalized elapsed progress, independent of frame rate. */
  function evaluateRacePlan(plan, progress) {
    return createRaceEvaluator(plan)(progress);
  }

  function validateRacePlan(plan) {
    var errors = [];
    if (!plan || typeof plan !== 'object') return { valid: false, errors: ['plan must be an object'] };
    if (!Array.isArray(plan.lanes) || plan.lanes.length === 0) errors.push('plan.lanes must be non-empty');
    if (!Array.isArray(plan.laneOrder)) errors.push('plan.laneOrder must be an array');
    if (!Number.isInteger(plan.winnerIndex)) errors.push('winnerIndex must be an integer');
    if (!Number.isFinite(plan.durationMs) || plan.durationMs < 1000) errors.push('durationMs is invalid');
    if (DRAMA_MODES.indexOf(plan.dramaMode) === -1) errors.push('dramaMode is invalid');

    if (Array.isArray(plan.lanes)) {
      var winnerCount = 0;
      var seenItems = Object.create(null);
      plan.lanes.forEach(function (lane, lanePosition) {
        if (!lane || typeof lane !== 'object') {
          errors.push('lane ' + lanePosition + ' is invalid');
          return;
        }
        if (lane.isWinner) winnerCount += 1;
        if (Object.prototype.hasOwnProperty.call(seenItems, lane.itemIndex)) errors.push('duplicate itemIndex ' + lane.itemIndex);
        seenItems[lane.itemIndex] = true;
        if (lane.laneIndex !== lanePosition) errors.push('laneIndex mismatch at lane ' + lanePosition);
        if (!Array.isArray(lane.trajectory) || lane.trajectory.length < 2) {
          errors.push('lane ' + lanePosition + ' has no usable trajectory');
          return;
        }
        var previousTime = -1;
        var previousProgress = -1;
        lane.trajectory.forEach(function (point, pointIndex) {
          if (!Number.isFinite(point.time) || (pointIndex > 0 && point.time <= previousTime) || point.time < 0 || point.time > 1) {
            errors.push('lane ' + lanePosition + ' has invalid checkpoint time');
          }
          if (!Number.isFinite(point.progress) || point.progress < previousProgress || point.progress < 0 || point.progress > 1) {
            errors.push('lane ' + lanePosition + ' has non-monotonic progress');
          }
          previousTime = point.time;
          previousProgress = point.progress;
        });
        var first = lane.trajectory[0];
        var last = lane.trajectory[lane.trajectory.length - 1];
        if (first.time !== 0 || first.progress !== 0) errors.push('lane ' + lanePosition + ' must start at zero');
        if (last.time !== 1) errors.push('lane ' + lanePosition + ' must end at time 1');
        if (lane.isWinner && last.progress !== 1) errors.push('winner must finish at 1');
        if (!lane.isWinner && last.progress >= 1) errors.push('loser must finish below 1');
      });
      if (winnerCount !== 1) errors.push('plan must contain exactly one winner');
      var winningLane = plan.lanes.filter(function (lane) { return lane.isWinner; })[0];
      if (winningLane && winningLane.itemIndex !== plan.winnerIndex) errors.push('winnerIndex does not match winning lane');
    }

    if (Array.isArray(plan.laneOrder) && Array.isArray(plan.lanes)) {
      if (plan.laneOrder.length !== plan.lanes.length) errors.push('laneOrder length mismatch');
      plan.lanes.forEach(function (lane, index) {
        if (plan.laneOrder[index] !== lane.itemIndex) errors.push('laneOrder mismatch at lane ' + index);
      });
    }
    return { valid: errors.length === 0, errors: errors };
  }

  /** Optional developer test. It is never run automatically. */
  function runSelfTest() {
    var failures = [];
    var caseCount = 0;
    var items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    DRAMA_MODES.forEach(function (mode, modeIndex) {
      for (var winnerIndex = 0; winnerIndex < items.length; winnerIndex += 1) {
        caseCount += 1;
        var options = { seed: 1000 + modeIndex * 10 + winnerIndex, dramaMode: mode, durationMs: 8000 };
        var first = createRacePlan(items, winnerIndex, options);
        var second = createRacePlan(items, winnerIndex, options);
        if (JSON.stringify(first) !== JSON.stringify(second)) failures.push(mode + ': plan is not deterministic');
        var validation = validateRacePlan(first);
        if (!validation.valid) failures.push(mode + ': ' + validation.errors.join(', '));
        var finish = evaluateRacePlan(first, 1);
        if (finish.leaderIndex !== winnerIndex) failures.push(mode + ': wrong final leader');
        [0, 0.1, 0.25, 0.5, 0.75, 0.999, 1].forEach(function (progress) {
          var frame = evaluateRacePlan(first, progress);
          frame.lanes.forEach(function (lane) {
            if (lane.progress < 0 || lane.progress > 1) failures.push(mode + ': evaluated progress out of range');
            if (!Number.isFinite(lane.speed) || lane.speed < 0) failures.push(mode + ': evaluated speed is invalid');
            if (!Number.isFinite(lane.acceleration)) failures.push(mode + ': evaluated acceleration is invalid');
            if (lane.boost < 0 || lane.boost > 1) failures.push(mode + ': boost intensity is invalid');
          });
        });
        var evaluator = createRaceEvaluator(first);
        [0.037, 0.333, 0.741, 0.963].forEach(function (progress) {
          if (JSON.stringify(evaluator(progress)) !== JSON.stringify(evaluateRacePlan(first, progress))) {
            failures.push(mode + ': compiled evaluator differs from direct evaluation');
          }
        });
      }
    });

    var largeField = Array.from({ length: 30 }, function (_, index) { return { id: 'team-' + index }; });
    for (var seed = 0; seed < 30; seed += 1) {
      var largeWinnerIndex = seed % largeField.length;
      var largePlan = createRacePlan(largeField, largeWinnerIndex, { seed: 50000 + seed });
      var largeFinish = evaluateRacePlan(largePlan, 1);
      var actualOrder = largeFinish.standings.map(function (lane) { return lane.itemIndex; });
      caseCount += 1;
      if (JSON.stringify(actualOrder) !== JSON.stringify(largePlan.finishOrder)) {
        failures.push('large field seed ' + seed + ': finishOrder does not match final positions');
      }
      var largeValidation = validateRacePlan(largePlan);
      if (!largeValidation.valid) {
        failures.push('large field seed ' + seed + ': ' + largeValidation.errors.join(', '));
      }
    }
    return { passed: failures.length === 0, failures: failures, cases: caseCount };
  }

  global.SECIRaceEngine = Object.freeze({
    version: ENGINE_VERSION,
    dramaModes: DRAMA_MODES.slice(),
    secureRandomIndex: secureRandomIndex,
    createRacePlan: createRacePlan,
    createRaceEvaluator: createRaceEvaluator,
    evaluateRacePlan: evaluateRacePlan,
    validateRacePlan: validateRacePlan,
    runSelfTest: runSelfTest
  });
})(window);
