import React, { Component, PureComponent } from 'react';
import {
  LayoutAnimation,
  YellowBox,
  Animated,
  FlatList,
  View,
  PanResponder,
  Platform,
  UIManager,
  StatusBar,
  StyleSheet,
} from 'react-native';
import PropTypes from 'prop-types';

// Measure function triggers false positives
YellowBox.ignoreWarnings(['Warning: isMounted(...) is deprecated']);
if (UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);


const initialState = {
  activeIndex: -1,
  showHoverComponent: false,
  spacerIndex: -1,
  scroll: false,
  hoverComponent: null,
  extraData: null,
};

const styles = StyleSheet.create({
  hoverComponent: {
    position: 'absolute',
  },
  wrapper: { flex: 1, opacity: 1 },
  fullOpacity: { opacity: 1 },
});

// Note using LayoutAnimation.easeInEaseOut() was causing blank spaces to
// show up in list: https://github.com/facebook/react-native/issues/13207
const layoutAnimConfig = {
  duration: 300,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.scaleXY,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.scaleXY,
  },
};

class SortableFlatList extends Component {
  _moveAnim = new Animated.Value(0)

  _moveAnimX = new Animated.Value(0)

  _moveAnimY = new Animated.Value(0)

  _offset = {
    x: new Animated.Value(0),
    y: new Animated.Value(0),
    _x: 0,
    _y: 0,
  }

  _hoverAnim = {
    x: Animated.add(this._moveAnimX, this._offset.x),
    y: Animated.add(this._moveAnimY, this._offset.y),
  }

  _transformAnim = new Animated.Value(0)

  _spacerIndex = -1

  _baseMeasurement = null;

  _measurements = []

  _scrollOffset = 0

  _containerSize

  _containerOffset

  _move = { x: 0, y: 0 }

  _hasMoved = false

  _refs = []

  _additionalOffset = 0

  _androidStatusBarOffset = 0

  _releaseVal = null

  _releaseAnim = null

  static propTypes = {
    data: PropTypes.array.isRequired,
    renderItem: PropTypes.func.isRequired,
    numColumns: PropTypes.number,
    placeholderColor: PropTypes.string,
    horizontal: PropTypes.bool,
    onMoveStart: PropTypes.func,
    onMoveEnd: PropTypes.func,
    scrollPercent: PropTypes.number,
    scrollSpeed: PropTypes.number,
    contentContainerStyle: PropTypes.any,
    extraData: PropTypes.any,
    keyExtractor: PropTypes.func,
    dragEnabled: PropTypes.bool,
    shrinkOnDragOnly: PropTypes.bool,
  }

  static defaultProps = {
    numColumns: 1,
    placeholderColor: '#000',
    horizontal: false,
    onMoveStart: () => {},
    onMoveEnd: () => {},
    scrollPercent: 5,
    scrollSpeed: 5,
    contentContainerStyle: {},
    extraData: null,
    keyExtractor: () => {},
    dragEnabled: false,
    shrinkOnDragOnly: false,
  };

  constructor(props) {
    super(props);
    this._panResponder = PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // console.log('onMoveShouldSetPanResponder');
        const { activeIndex } = this.state;
        const { horizontal } = this.props;
        const { moveX, moveY } = gestureState;
        const move = horizontal ? moveX : moveY;
        const shouldSet = activeIndex > -1;
        this._moveAnim.setValue(move);
        this._moveAnimX.setValue(moveX);
        this._moveAnimY.setValue(moveY);
        if (shouldSet) {
          // this.setState({ showHoverComponent: true });
          // Kick off recursive row animation
          this.animate();
          this._hasMoved = true;
        }
        return shouldSet;
      },
      onPanResponderMove: Animated.event([null, { moveX: this._moveAnimX, moveY: this._moveAnimY }], {
        listener: (evt, gestureState) => {
          const { moveX, moveY } = gestureState;
          if (this._move.x !== moveX || this._move.y !== moveY) {
            // console.log('onPanResponderMove', moveX, moveY);
            this._move.x = moveX;
            this._move.y = moveY;
          }
        },
      }),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => {
        // console.log('onPanResponderRelease');
        const { activeIndex, spacerIndex } = this.state;
        const { data, horizontal, shrinkOnDragOnly } = this.props;
        const activeMeasurements = this._measurements[activeIndex];
        const spacerMeasurements = this._measurements[spacerIndex];
        const lastElementMeasurements = this._measurements[data.length - 1];
        if (activeIndex === -1) return;
        // If user flings row up and lets go in the middle of an animation measurements can error out.
        // Give layout animations some time to complete and animate element into place before calling onMoveEnd

        // Spacers have different positioning depending on whether the spacer row is before or after the active row.
        // This is because the active row animates to height 0, so everything after it shifts upwards, but everything before
        // it shifts downward
        const isLastElement = spacerIndex >= data.length;
        const spacerElement = isLastElement ? lastElementMeasurements : spacerMeasurements;
        if (!spacerElement) return;
        const {
          x, y, width, height,
        } = spacerElement;
        const offset = horizontal ? x : y;
        const pos = offset - this._scrollOffset;
        const activeItemSize = horizontal ? activeMeasurements.width : activeMeasurements.height;
        this._releaseVal = pos + activeItemSize / 2;
        const otherSize = horizontal ? height : width;
        const otherReleaseVal = (horizontal ? y : x) + (isLastElement ? otherSize : 0);
        if (this._releaseAnim) this._releaseAnim.stop();
        this._releaseAnim = Animated.parallel([
          Animated.spring(horizontal ? this._moveAnimX : this._moveAnimY, {
            toValue: this._releaseVal,
            stiffness: 5000,
            damping: 500,
            mass: 3,
            useNativeDriver: true,
            duration: 300,
          }),
          Animated.spring(horizontal ? this._moveAnimY : this._moveAnimX, {
            toValue: otherReleaseVal,
            stiffness: 5000,
            damping: 500,
            mass: 3,
            useNativeDriver: true,
            duration: 300,
          }),
          shrinkOnDragOnly ? this.animateExpandItem() : null,
        ]);

        this._releaseAnim.start(this.onReleaseAnimationEnd);
      },
    });
    this.state = initialState;
  }

  componentWillReceiveProps(nextProps) {
    const { extraData, dragEnabled } = this.props;
    if (extraData !== nextProps.extraData) {
      this.setState({ extraData });
    }

    if (dragEnabled !== nextProps.dragEnabled
      && nextProps.dragEnabled === true
      && nextProps.shrinkOnDragOnly === false) {
      this.animateShrinkItem().start();
    } else if (
      dragEnabled !== nextProps.dragEnabled
      && nextProps.dragEnabled === false
      && nextProps.shrinkOnDragOnly === false
    ) {
      this.animateExpandItem().start();
    }
  }

  onReleaseAnimationEnd = () => {
    // console.log('onReleaseAnimationEnd');
    const { data, onMoveEnd } = this.props;
    const { activeIndex, spacerIndex } = this.state;
    const sortedData = this.getSortedList(data, activeIndex, spacerIndex);
    const isAfterActive = spacerIndex > activeIndex;
    const from = activeIndex;
    const to = spacerIndex - (isAfterActive ? 1 : 0);
    this._moveAnim.setValue(this._releaseVal);
    this._spacerIndex = -1;
    this._hasMoved = false;
    this._move.x = 0;
    this._move.y = 0;
    this._releaseAnim = null;
    this.setState(initialState, () => {
      if (onMoveEnd) onMoveEnd({
        item: data[activeIndex],
        from,
        to,
        data: sortedData,
      });
    });
  }

  getSortedList = (data, activeIndex, spacerIndex) => {
    if (activeIndex === spacerIndex) return data;
    const sortedData = data.reduce((acc, cur, i, arr) => {
      if (i === activeIndex) return acc;
      if (i === spacerIndex) {
        acc = [...acc, arr[activeIndex], cur]; // eslint-disable-line no-param-reassign
      } else acc.push(cur);
      return acc;
    }, []);
    if (spacerIndex >= data.length) sortedData.push(data[activeIndex]);
    return sortedData;
  }

  animate = () => {
    const { activeIndex } = this.state;
    const {
      scrollPercent, data, scrollSpeed, horizontal, numColumns,
    } = this.props;
    const scrollRatio = scrollPercent / 100;
    if (activeIndex === -1) return;
    const nextSpacerIndex = this.getSpacerIndex(activeIndex);
    // console.log('nextSpacerIndex', nextSpacerIndex);
    if (nextSpacerIndex > -1 && nextSpacerIndex !== this._spacerIndex) {
      // console.log('nextSpacerIndex', nextSpacerIndex);
      LayoutAnimation.configureNext(layoutAnimConfig);
      this.setState({ spacerIndex: nextSpacerIndex });
      this._spacerIndex = nextSpacerIndex;
      if (nextSpacerIndex === data.length) this._flatList.scrollToEnd();
    }

    const lastRow = Math.floor((data.length - 1) / 3);
    // Scroll if hovering in top or bottom of container and have set a scroll %
    const isLastRow = (Math.floor(activeIndex / 3) === lastRow) || nextSpacerIndex === data.length;
    const isFirstRow = activeIndex < numColumns;
    if (this._measurements[activeIndex]) {
      const move = horizontal ? this._move.x : this._move.y;
      // const rowSize = this._measurements[activeIndex][horizontal ? 'width' : 'height'];
      // const hoverItemTopPosition = Math.max(0, move - (this._additionalOffset + this._containerOffset));
      // const hoverItemBottomPosition = Math.min(this._containerSize, hoverItemTopPosition + rowSize);
      const fingerPosition = Math.max(0, move - this._containerOffset);
      const shouldScrollUp = !isFirstRow && fingerPosition < (this._containerSize * scrollRatio);
      const shouldScrollDown = !isLastRow && fingerPosition > (this._containerSize * (1 - scrollRatio));
      if (shouldScrollUp) this.scroll(-scrollSpeed, nextSpacerIndex);
      else if (shouldScrollDown) this.scroll(scrollSpeed, nextSpacerIndex);
    }

    requestAnimationFrame(this.animate);
  }

  animateShrinkItem = () => (
    Animated.timing(this._transformAnim, {
      toValue: 1,
      useNativeDriver: true,
      duration: 300,
    })
  )

  animateExpandItem = () => (
    Animated.timing(this._transformAnim, {
      toValue: 0,
      useNativeDriver: true,
      delay: 200,
      duration: 100,
    })
  )

  scroll = (scrollAmt, spacerIndex) => {
    const { data } = this.props;
    if (spacerIndex >= data.length) {
      this._flatList.scrollToEnd(); return;
    }
    if (spacerIndex === -1) return;
    const currentScrollOffset = this._scrollOffset;
    const newOffset = currentScrollOffset + scrollAmt;
    const offset = Math.max(0, newOffset);
    this._flatList.scrollToOffset({ offset, animated: false });
  }


  getSpacerIndex = (activeIndex) => {
    const { horizontal } = this.props;
    if (activeIndex === -1 || !this._measurements[activeIndex]) return -1;
    const hoverPointX = Math.floor(this._move.x + (horizontal ? this._scrollOffset : 0));
    const hoverPointY = Math.floor(this._move.y + (horizontal ? 0 : (this._scrollOffset + 10)));
    // console.log('here getSpacerIndex', hoverPointX, hoverPointY, this._measurements[activeIndex]);
    let addIndex = false;
    const spacerIndex = this._measurements.findIndex(({
      width, height, x, y,
    }) => {
      // if (!horizontal && numColumns > 1) {
      const isCurrent = (hoverPointX >= x && hoverPointX <= x + width)
        && (hoverPointY >= y && hoverPointY <= y + height);
      // console.log('here hoverPointX', hoverPointX, 'hoverPointY', hoverPointY, x, y, width, height, `, ${this._move.y}, ${this._scrollOffset}`);
      if (isCurrent && (hoverPointX > x + width / 2)) addIndex = true;
      return isCurrent;
      // }
    });
    // console.log(`here hoverPointX ${hoverPointX}, hoverPointY ${hoverPointY}, ${this._move.y}, ${this._scrollOffset}, ${spacerIndex}`);
    // }
    // Spacer index differs according to placement. See note in onPanResponderRelease
    // return spacerIndex > activeIndex ? spacerIndex + 1 : spacerIndex;
    // console.log('here spacerIndex', spacerIndex);
    return addIndex ? spacerIndex + 1 : spacerIndex;
  }

  measureItem = (index) => {
    const { activeIndex } = this.state;
    const { horizontal, numColumns } = this.props;
    // setTimeout required or else dimensions reported as 0
    if (this._refs[index]) setTimeout(() => {
      try {
        // Using stashed ref prevents measuring an unmounted component, which throws an error
        if (this._refs[index]) this._refs[index].measureInWindow(((x, y, width, height) => {
          if ((width || height) && activeIndex === -1) {
            const ypos = y + this._scrollOffset;
            const xpos = x + this._scrollOffset;
            this._measurements[index] = {
              y: horizontal ? y : ypos,
              x: horizontal ? xpos : x,
              width,
              height,
            };
            if (index === 0) { this._baseMeasurement = this._measurements[index]; }
          } else if (this._baseMeasurement) {
            // assume all items are in the same size
            const item = this._baseMeasurement;
            const column = (index % numColumns);
            const row = Math.floor(index / numColumns);
            this._measurements[index] = {
              y: item.y + (row * item.height),
              x: item.x + (column * item.width),
              width: item.width,
              height: item.height,
            };
          }
        }));
      } catch (e) {
        console.log('## measure error -- index: ', index, activeIndex, this._refs[index], e);
      }
    }, 100);
  }

  moveStart = (evt, hoverComponent, index) => {
    // console.log('here move', index);
    const { pageX, pageY } = evt.nativeEvent;
    const { horizontal, onMoveStart, shrinkOnDragOnly } = this.props;
    if (this._releaseAnim) {
      this._releaseAnim.stop();
      this.onReleaseAnimationEnd();
      return;
    }
    this._refs.forEach((ref, i) => this.measureItem(i));
    this._spacerIndex = index;

    const tappedPixel = horizontal ? pageX : pageY;
    // console.log('Math.floor(this._scrollOffset + tappedPixel)', Math.floor(this._scrollOffset + tappedPixel));
    this._additionalOffset = (tappedPixel + this._scrollOffset) - this._measurements[index][horizontal ? 'x' : 'y'];
    if (this._releaseAnim) {
      return;
    }
    this._moveAnim.setValue(tappedPixel);
    this._moveAnimX.setValue(pageX);
    this._moveAnimY.setValue(pageY);
    this._move.x = pageX;
    this._move.y = pageY;
    // console.log(`start at tappedPixel: ${tappedPixel}, index: ${index}, _additionalOffset: ${this._additionalOffset}`);
    // console.log(`start at pageX: ${pageX}, pageY: ${pageY}`, this._measurements[index]);
    // console.log(`start at container pageX: ${this._containerDimension.pageX}, pageY: ${this._containerDimension.pageY}`);

    // compensate for translucent or hidden StatusBar on android
    if (Platform.OS === 'android' && !horizontal) {
      const isTranslucent = StatusBar._propsStack.reduce(
        ((acc, cur) => (cur.translucent === undefined ? acc : cur.translucent)),
        false,
      );

      const isHidden = StatusBar._propsStack.reduce(
        ((acc, cur) => (cur.hidden === null ? acc : cur.hidden.value)),
        false,
      );

      this._androidStatusBarOffset = (isTranslucent || isHidden) ? StatusBar.currentHeight : 0;
    }

    const offset = (this._containerOffset - this._androidStatusBarOffset) * -1;
    // console.log(`start at _scrollOffset: ${this._scrollOffset}, _containerOffset: ${this._containerOffset}, offset: ${offset}`);
    if (horizontal) {
      this._offset._x = offset;
      this._offset._y = (pageY - this._measurements[index].y) * -1;
    } else {
      // this._offset.x.setValue((pageX - this._measurements[index].x) * -1);
      // this._offset.y.setValue(offset);
      this._offset._x = this._measurements[index].width * -0.5;
      this._offset._y = offset + this._measurements[index].height * -0.5;
    }
    this._offset.x.setValue(this._offset._x);
    this._offset.y.setValue(this._offset._y);

    if (shrinkOnDragOnly) {
      this.animateShrinkItem().start();
    }

    this.setState({
      activeIndex: index,
      spacerIndex: index,
      hoverComponent,
    }, () => onMoveStart && onMoveStart(index));
  }

  moveEnd = () => {
    if (!this._hasMoved) this.setState(initialState);
  }

  setRef = index => (ref) => {
    if (ref) {
      this._refs[index] = ref;
      this.measureItem(index);
    }
  }

  renderItem = ({ item, index }) => {
    const {
      renderItem, data, horizontal, numColumns, placeholderColor,
    } = this.props;
    const { activeIndex, spacerIndex, extraData } = this.state;
    const isActiveItem = activeIndex === index;
    const isSpacerRow = spacerIndex === index || (spacerIndex >= data.length && index === data.length - 1);

    const spacerAfter = spacerIndex >= data.length;

    // const isDragging = spacerIndex >= 0;
    const showVerticalLine = horizontal || (!horizontal && numColumns > 1);
    const spacerSize = '85%';
    const spacerMargin = '7.5%';
    const spacerBeforeOffset = (index % numColumns === 0) ? 0 : -1;
    const spacerAfterOffset = (index % numColumns === numColumns - 1) ? 0 : -1;

    const spacerStyle = {
      position: 'absolute',
      backgroundColor: placeholderColor,
      zIndex: 2,
      ...(showVerticalLine ? { width: 2, height: spacerSize } : { height: 2, width: spacerSize }),
    };

    const initialSpace = 0.2 / (numColumns * 2);
    const supposedSpacing = 0.2 / (numColumns + 1);
    const container = this._containerDimension ? this._containerDimension.width : 0;

    const column = index % numColumns;
    const displacement = ((column + 1) * supposedSpacing) - ((column * 2 + 1) * initialSpace);
    const left = (initialSpace + displacement) - supposedSpacing / 2;
    const right = (initialSpace - displacement) - supposedSpacing / 2;

    return (
      <View style={[styles.fullOpacity, { flex: 1 / numColumns, position: 'relative' }]}>
        <Animated.View style={{
          transform: [{
            scale: this._transformAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0.8],
            }),
          }, {
            translateX: this._transformAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, displacement * container],
            }),
          }],
        }}
        >
          <RowItem
            horizontal={horizontal}
            index={index}
            isActiveItem={isActiveItem}
            renderItem={renderItem}
            item={item}
            setRef={this.setRef}
            moveStart={this.moveStart}
            moveEnd={this.moveEnd}
            extraData={extraData}
          />
        </Animated.View>
        {isSpacerRow && !spacerAfter
        && (
          <View style={[
            spacerStyle,
            showVerticalLine
              ? { top: spacerMargin, left: left * container - 1 }
              : { top: spacerBeforeOffset, left: spacerMargin },
          ]}
          />
        )}
        {isSpacerRow && spacerAfter
        && (
          <View style={[
            spacerStyle,
            showVerticalLine
              ? { top: spacerMargin, right: right * container - 1 }
              : { bottom: spacerAfterOffset, left: spacerMargin },
          ]}
          />
        )}
      </View>
    );
  }

  renderHoverComponent = () => {
    const { hoverComponent } = this.state;
    const { horizontal, numColumns } = this.props;
    return !!hoverComponent && (
      <Animated.View style={[
        styles.hoverComponent,
        horizontal && { height: this._containerDimension.height / numColumns },
        !horizontal && { width: this._containerDimension.width / numColumns },
        {
          opacity: 0.8,
          transform: [{ translateX: this._hoverAnim.x }, { translateY: this._hoverAnim.y }, { scale: 0.8 }],
        },
      ]}
      >
        {hoverComponent}
      </Animated.View>
    );
  }

  measureContainer = ref => {
    if (ref && this._containerOffset === undefined) {
      // setTimeout required or else dimensions reported as 0
      setTimeout(() => {
        const { horizontal } = this.props;
        ref.measure((x, y, width, height, pageX, pageY) => {
          // console.log('here measure', width, height, pageX, pageY);
          this._containerOffset = horizontal ? pageX : pageY;
          this._containerSize = horizontal ? width : height;
          this._containerDimension = {
            width, height, pageX, pageY,
          };
        });
      }, 50);
    }
  }

  keyExtractor = (item, index) => `sortable-flatlist-item-${index}`

  render() {
    const { horizontal, keyExtractor } = this.props;
    const { activeIndex } = this.state;

    return (
      <View
        ref={this.measureContainer}
        // ref.measure will not return anything if no onLayout
        // https://github.com/facebook/react-native/issues/3282
        onLayout={() => {}}
        {...this._panResponder.panHandlers}
        style={styles.wrapper} // Setting { opacity: 1 } fixes Android measurement bug: https://github.com/facebook/react-native/issues/18034#issuecomment-368417691
      >
        <FlatList
          {...this.props}
          scrollEnabled={activeIndex === -1}
          ref={ref => { this._flatList = ref; }}
          renderItem={this.renderItem}
          extraData={this.state}
          keyExtractor={keyExtractor || this.keyExtractor}
          onScroll={({ nativeEvent }) => { this._scrollOffset = nativeEvent.contentOffset[horizontal ? 'x' : 'y']; }}
          scrollEventThrottle={16}
        />
        {this.renderHoverComponent()}
      </View>
    );
  }
}

export default SortableFlatList;

class RowItem extends PureComponent {
  static propTypes = {
    item: PropTypes.any.isRequired,
    index: PropTypes.number,
    moveStart: PropTypes.func,
    moveEnd: PropTypes.func,
    renderItem: PropTypes.func.isRequired,
    isActiveItem: PropTypes.bool,
    horizontal: PropTypes.bool,
    setRef: PropTypes.func,
    style: PropTypes.any,
  };

  static defaultProps = {
    index: null,
    moveStart: () => {},
    moveEnd: () => {},
    isActiveItem: false,
    horizontal: false,
    setRef: () => {},
    style: {},
  };

  moveStart = (evt) => {
    const {
      moveStart, moveEnd, renderItem, item, index,
    } = this.props;
    const hoverComponent = renderItem({
      isActive: true, item, index, moveStart: () => null, moveEnd,
    });
    moveStart(evt, hoverComponent, index);
  }

  render() {
    const {
      moveEnd, isActiveItem, horizontal, renderItem, item, index, setRef, style,
    } = this.props;
    const component = renderItem({
      isActive: false,
      item,
      index,
      moveStart: this.moveStart,
      moveEnd,
    });

    // Rendering the final row requires padding to be applied at the bottom
    return (
      <View
        ref={setRef(index)}
        collapsable={false}
        style={[
          { opacity: 1, flexDirection: horizontal ? 'row' : 'column' },
          isActiveItem && { backgroundColor: '#EFEFEF' },
          style,
        ]}
      >
        <View style={isActiveItem && { opacity: 0 }}>
          {component}
        </View>
      </View>
    );
  }
}
