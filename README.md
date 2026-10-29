# GreenarcTest

# Trip analyser: user manual
 
The trip analyser shows what happened on a single journey made by a Meadow Distribution vehicle. Enter a trip ID and the page draws a chart of that trip, with one point for each telemetry sample (a reading taken every 5 minutes). All data shown is synthetic.
 
## Opening a trip
 
1. Type a trip ID (for example `TRP0010`) into the **Trip ID** box. Suggestions appear as you type.
2. Press **Show trip** or the Enter key.
If the ID isn't found, the page says so. Capital letters and extra spaces don't matter. You can also open a trip straight from a link ending in `#` and the trip ID, such as `index.html#TRP0010`, which is handy for sharing.
 
## Trip details
 
Above the chart, the trip details panel shows the vehicle and its type, the depot, the driver, the route type, load band and weather, the start and end time, and how many samples were recorded compared with how many were expected.
 
## The chart
 
Each point is one telemetry sample. The horizontal axis is the time of day in UTC, and the vertical axis is the metric you've chosen. Hover over a point to see the time, the sample number, the value for that interval, the running total, and any warnings. Drag across the chart to zoom in.
 
### Choosing what to show
 
- **Metric:** Distance (km), Fuel used (L), Idle time (seconds) or Engine-on time (seconds). Idle time is part of engine-on time, and fuel already includes the fuel used while idling.
- **Cumulative:** off shows the amount in each 5-minute interval. On shows the running total from the start of the trip to that point.
- **Show driving events:** adds a dashed vertical line, labelled with the event type and severity, at the time the vehicle's detector recorded an event (harsh braking, harsh acceleration or a speeding signal).
### Reading the markers
 
| What you see | What it means |
|---|---|
| Break in the line | The reading for that interval was missing or invalid. It is shown as a gap, never as zero. |
| Filled orange point | One or more samples are missing just before this point. |
| Hollow orange point (cumulative view) | The running total is a lower bound, because an earlier reading was unavailable. The true total is at least this much. |
 
## Data quality for this trip
 
The yellow box under the chart lists any problems found in this trip's data:
 
- missing 5-minute intervals
- duplicate rows that were removed
- missing or implausible fuel readings
- invalid distance readings
It reads "no issues found" when there are none. Trips with problems to look at: `TRP0114` and `TRP0128` (missing intervals), `TRP0010` and `TRP0030` (implausible fuel), `TRP0004` (missing fuel), `TRP0007` (invalid distance) and `TRP0136` (many duplicates removed). `TRP0001` has no issues.
 
## Keeping the results in context
 
- Readings are taken every 5 minutes, so short events such as a brief stop or a burst of idling can be averaged out or missed.
- Where data is missing, totals for that trip are lower bounds.
- Driving events are signals worth investigating. They don't show that a driver was at fault, and route, load, weather and traffic all affect them. They shouldn't be used for decisions about drivers.
- There is no location data, so the chart can't show where on the route something happened.
- Times are in UTC.
 
