// det(I + s*A) = 1 + s*tr(A) + s^2*sum(principal minors) + s^3*det(A).
export function detCoefficients(a) {
  return [
    a[0] + a[4] + a[8],
    a[0]*a[4] + a[0]*a[8] + a[4]*a[8] - a[1]*a[3] - a[2]*a[6] - a[5]*a[7],
    a[0]*(a[4]*a[8]-a[5]*a[7]) - a[1]*(a[3]*a[8]-a[5]*a[6]) + a[2]*(a[3]*a[7]-a[4]*a[6]),
  ];
}

// A continuous limit avoids the visible 100% -> 50% -> 100% jumps from a
// powers-of-two safety clamp. The coefficients cover all displayed layers.
export function safeTransferScale(coefficients, minDet = 0.25) {
  // The determinant is cubic, not necessarily monotone in s. Bound the search
  // by its first unsafe stationary point so recovery cannot cross an inverted
  // interval even when the full-scale endpoint happens to be positive again.
  let hi=1;
  for(let i=0;i<coefficients.length;i+=3) {
    const a=coefficients[i], b=coefficients[i+1], c=coefficients[i+2];
    if(![a,b,c].every(Number.isFinite)) return 0;
    const critical=[];
    if(Math.abs(c)>1e-12) {
      const discriminant=b*b-3*c*a;
      if(discriminant>=0) critical.push((-b-Math.sqrt(discriminant))/(3*c),(-b+Math.sqrt(discriminant))/(3*c));
    } else if(Math.abs(b)>1e-12) critical.push(-a/(2*b));
    for(const t of critical) if(t>0 && t<hi && 1+t*(a+t*(b+t*c))<minDet) hi=t;
  }
  const safe = s => {
    for (let i=0;i<coefficients.length;i+=3) {
      const j=1+s*(coefficients[i]+s*(coefficients[i+1]+s*coefficients[i+2]));
      if (!Number.isFinite(j) || j<minDet) return false;
    }
    return true;
  };
  if (hi===1 && safe(1)) return 1;
  let lo=0;
  for (let i=0;i<12;i++) {
    const mid=(lo+hi)/2;
    if(safe(mid)) lo=mid; else hi=mid;
  }
  return lo;
}
