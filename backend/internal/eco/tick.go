package eco

import "math"

type PrizeRollFunc func() (string, bool)

func AdvanceState(snapshot StateSnapshot, nowMs int64) (StateSnapshot, TickResult) {
	return AdvanceStateWithPrizeRoll(snapshot, nowMs, nil)
}

func AdvanceStateWithPrizeRoll(snapshot StateSnapshot, nowMs int64, rollPrize PrizeRollFunc) (StateSnapshot, TickResult) {
	if nowMs <= 0 {
		nowMs = snapshot.LastTickAtMs
	}
	last := snapshot.LastTickAtMs
	if last <= 0 {
		last = nowMs
	}
	elapsedMs := maxInt64(0, nowMs-last)
	if elapsedMs <= 0 {
		snapshot.LastTickAtMs = nowMs
		return snapshot, TickResult{ElapsedMs: 0, PrizeKeys: []string{}}
	}

	spawnPerMin := EffectiveSpawnPerMin(snapshot)
	autoPerMin := EffectiveAutoPerMin(snapshot)
	capacity := StorageCap(snapshot)

	spawned := int64(0)
	if spawnPerMin > 0 {
		msPer := float64(60000) / float64(spawnPerMin)
		total := float64(snapshot.SpawnLeftoverMs) + float64(elapsedMs)
		spawned = int64(math.Floor(total / msPer))
		snapshot.SpawnLeftoverMs = int64(math.Floor(total - float64(spawned)*msPer))
	} else {
		snapshot.SpawnLeftoverMs = 0
	}

	autoCapacity := int64(0)
	if autoPerMin > 0 {
		msPer := float64(60000) / float64(autoPerMin)
		total := float64(snapshot.AutoLeftoverMs) + float64(elapsedMs)
		autoCapacity = int64(math.Floor(total / msPer))
		snapshot.AutoLeftoverMs = int64(math.Floor(total - float64(autoCapacity)*msPer))
		offlineCap := autoPerMin * OfflineAutoCapMinute
		if autoCapacity > offlineCap {
			autoCapacity = offlineCap
			snapshot.AutoLeftoverMs = 0
		}
	} else {
		snapshot.AutoLeftoverMs = 0
	}

	visibleCount := int64(len(snapshot.VisiblePrizes))
	pending := minInt64(maxInt64(0, snapshot.Pending), maxInt64(0, capacity-visibleCount))
	freeSlots := maxInt64(0, capacity-pending-visibleCount)

	autoCollected := minInt64(autoCapacity, pending)
	pending -= autoCollected
	remainingAuto := autoCapacity - autoCollected
	freeSlots = maxInt64(0, capacity-pending-visibleCount)

	acceptedSpawned := int64(0)
	trashSpawned := int64(0)
	prizeKeys := []string{}
	for index := int64(0); index < spawned; index++ {
		if freeSlots <= 0 && remainingAuto <= 0 {
			break
		}
		if freeSlots > 0 && rollPrize != nil {
			if prizeKey, ok := rollPrize(); ok && isPrizeKey(prizeKey) {
				acceptedSpawned++
				prizeKeys = append(prizeKeys, prizeKey)
				freeSlots--
				continue
			}
		}
		acceptedSpawned++
		if remainingAuto > 0 {
			remainingAuto--
			autoCollected++
			continue
		}
		pending++
		trashSpawned++
		freeSlots = maxInt64(0, capacity-pending-visibleCount)
	}

	snapshot.Pending = pending
	snapshot.LastTickAtMs = nowMs
	return snapshot, TickResult{
		Spawned:         spawned,
		AcceptedSpawned: acceptedSpawned,
		TrashSpawned:    trashSpawned,
		PrizeKeys:       prizeKeys,
		AutoCollected:   autoCollected,
		ElapsedMs:       elapsedMs,
	}
}

func EffectiveSpawnPerMin(snapshot StateSnapshot) int64 {
	return BaseSpawnPerMin + UpgradeLevel(snapshot, "spawn")*3
}

func StorageCap(snapshot StateSnapshot) int64 {
	return BaseStorageCap + UpgradeLevel(snapshot, "storage")*40
}

func PointMultiplier(snapshot StateSnapshot) int64 {
	return BasePointMultiplier + UpgradeLevel(snapshot, "value")
}

func EffectiveAutoPerMin(snapshot StateSnapshot) int64 {
	level := UpgradeLevel(snapshot, "auto")
	if level <= 0 {
		return 0
	}
	if int(level) >= len(AutoRateByLevel) {
		return AutoRateByLevel[len(AutoRateByLevel)-1]
	}
	return AutoRateByLevel[level]
}

func GrabSize(snapshot StateSnapshot) int64 {
	return BaseGrabSize + UpgradeLevel(snapshot, "storage")/2
}

func UpgradeLevel(snapshot StateSnapshot, key string) int64 {
	if snapshot.Upgrades == nil {
		return 0
	}
	return maxInt64(0, snapshot.Upgrades[key])
}
