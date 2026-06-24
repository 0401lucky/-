package whackmole

const (
	rngWidth        = 256
	rngChunks       = 6
	rngStartDenom   = 281474976710656.0
	rngSignificance = 4503599627370496.0
	rngOverflow     = 9007199254740992.0
	rngMask         = rngWidth - 1
)

type seedRandom struct {
	i int
	j int
	s [rngWidth]int
}

func newSeedRandom(seed string) *seedRandom {
	key := mixKey(seed)
	rng := &seedRandom{}
	for i := 0; i < rngWidth; i++ {
		rng.s[i] = i
	}
	j := 0
	if len(key) == 0 {
		key = []int{0}
	}
	for i := 0; i < rngWidth; i++ {
		t := rng.s[i]
		j = rngMask & (j + key[i%len(key)] + t)
		rng.s[i], rng.s[j] = rng.s[j], t
	}
	_ = rng.g(rngWidth)
	return rng
}

func (rng *seedRandom) Float64() float64 {
	n := float64(rng.g(rngChunks))
	d := rngStartDenom
	x := 0
	for n < rngSignificance {
		n = (n + float64(x)) * rngWidth
		d *= rngWidth
		x = rng.g(1)
	}
	for n >= rngOverflow {
		n /= 2
		d /= 2
		x >>= 1
	}
	return (n + float64(x)) / d
}

func (rng *seedRandom) g(count int) int {
	r := 0
	for count > 0 {
		rng.i = rngMask & (rng.i + 1)
		t := rng.s[rng.i]
		rng.j = rngMask & (rng.j + t)
		rng.s[rng.i], rng.s[rng.j] = rng.s[rng.j], t
		r = r*rngWidth + rng.s[rngMask&(rng.s[rng.i]+rng.s[rng.j])]
		count--
	}
	return r
}

func mixKey(seed string) []int {
	key := make([]int, rngWidth)
	smear := 0
	maxIndex := -1
	for j, char := range []byte(seed) {
		index := rngMask & j
		smear ^= key[index] * 19
		key[index] = rngMask & (smear + int(char))
		if index > maxIndex {
			maxIndex = index
		}
	}
	if maxIndex < 0 {
		return nil
	}
	return key[:maxIndex+1]
}
